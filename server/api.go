package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

const (
	apiVersion = "1"
	maxBody    = 12 << 20 // full file-save request body
	maxDoc     = 10 << 20 // serialized document
	maxName    = 200
	maxUpload  = 10 << 20 // one asset file
)

var allowedOrigins = map[string]bool{
	"http://localhost:5173": true,
	"http://127.0.0.1:5173": true,
}

// API routes /api/* and serves the built frontend for everything else.
type API struct {
	accounts *Accounts
	web      fs.FS
	static   http.Handler
	google   *GoogleOAuth
	imports  *ImportService
}

func NewAPI(accounts *Accounts, web fs.FS, google ...*GoogleOAuth) *API {
	g := NewGoogleOAuth("", "", "", nil)
	if len(google) > 0 && google[0] != nil {
		g = google[0]
	}
	return &API{
		accounts: accounts,
		web:      web,
		static:   http.FileServer(http.FS(web)),
		google:   g,
		imports:  NewImportService(false),
	}
}

type authKey struct{}

type authInfo struct {
	user  User
	token string
}

func authFrom(r *http.Request) *authInfo {
	ai, _ := r.Context().Value(authKey{}).(*authInfo)
	return ai
}

func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	rec := &recorder{ResponseWriter: w, status: http.StatusOK}
	defer func() {
		slog.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start).String(),
		)
	}()

	if !isAPIPath(r.URL.Path) {
		a.serveWeb(rec, r)
		return
	}

	h := rec.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Vary", "Origin")
	if origin := r.Header.Get("Origin"); origin != "" && allowedOrigins[origin] {
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Allow-Credentials", "true")
		h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		h.Set("Access-Control-Allow-Headers", "Content-Type")
		h.Set("Access-Control-Max-Age", "600")
	}
	if r.Method == http.MethodOptions {
		rec.WriteHeader(http.StatusNoContent)
		return
	}

	if isProtectedPath(r.URL.Path) {
		user, ok := a.accounts.Authenticate(sessionToken(r))
		if !ok {
			writeErr(rec, http.StatusUnauthorized, "unauthenticated")
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), authKey{}, &authInfo{
			user: user, token: sessionToken(r),
		}))
	}
	a.serveAPI(rec, r)
}

func isAPIPath(p string) bool {
	return p == "/api" || strings.HasPrefix(p, "/api/")
}

func isProtectedPath(p string) bool {
	switch p {
	case "/api/files", "/api/assets", "/api/settings", "/api/account", "/api/import":
		return true
	}
	return strings.HasPrefix(p, "/api/files/") ||
		strings.HasPrefix(p, "/api/assets/") ||
		strings.HasPrefix(p, "/api/account/") ||
		strings.HasPrefix(p, "/api/import/")
}

func (a *API) serveAPI(w http.ResponseWriter, r *http.Request) {
	parts := splitPath(r.URL.Path)
	if len(parts) == 0 || parts[0] != "api" {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	for _, p := range parts {
		if p == "." || p == ".." {
			writeErr(w, http.StatusBadRequest, "invalid path")
			return
		}
	}

	switch {
	case len(parts) == 2 && parts[1] == "health":
		a.health(w, r)
	case len(parts) == 3 && parts[1] == "auth" && parts[2] == "config":
		a.authConfig(w, r)
	case len(parts) == 4 && parts[1] == "auth" && parts[2] == "google" && parts[3] == "start":
		a.googleStart(w, r)
	case len(parts) == 4 && parts[1] == "auth" && parts[2] == "google" && parts[3] == "callback":
		a.googleCallback(w, r)
	case len(parts) == 3 && parts[1] == "auth":
		a.authRoute(w, r, parts[2])
	case len(parts) >= 2 && parts[1] == "files":
		a.files(w, r, parts[2:])
	case len(parts) == 2 && parts[1] == "assets":
		a.assets(w, r)
	case len(parts) == 3 && parts[1] == "assets":
		a.asset(w, r, parts[2])
	case len(parts) == 2 && parts[1] == "settings":
		a.settings(w, r)
	case len(parts) >= 2 && parts[1] == "import":
		a.importRoutes(w, r, parts[2:])
	case len(parts) == 2 && parts[1] == "account":
		a.account(w, r)
	case len(parts) == 3 && parts[1] == "account":
		a.accountAction(w, r, parts[2])
	default:
		writeErr(w, http.StatusNotFound, "not found")
	}
}

func splitPath(p string) []string {
	p = strings.Trim(p, "/")
	if p == "" {
		return nil
	}
	return strings.Split(p, "/")
}

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	files, assets := a.accounts.Counts()
	writeJSON(w, http.StatusOK, struct {
		OK           bool   `json:"ok"`
		Version      string `json:"version"`
		Files        int    `json:"files"`
		Assets       int    `json:"assets"`
		AuthRequired bool   `json:"authRequired"`
	}{true, apiVersion, files, assets, true})
}

// ---- auth ----

func (a *API) authRoute(w http.ResponseWriter, r *http.Request, action string) {
	switch action {
	case "register":
		a.register(w, r)
	case "login":
		a.login(w, r)
	case "logout":
		a.logout(w, r)
	case "me":
		a.me(w, r)
	default:
		writeErr(w, http.StatusNotFound, "not found")
	}
}

func (a *API) register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := decodeJSON(w, r, &req, 1<<20); err != nil {
		writeDecodeErr(w, err)
		return
	}
	user, token, err := a.accounts.Register(req.Email, req.Password, req.Name)
	if err != nil {
		switch {
		case errors.Is(err, errEmailTaken):
			writeErr(w, http.StatusConflict, err.Error())
		case errors.Is(err, errInvalidEmail), errors.Is(err, errWeakPassword), errors.Is(err, errInvalidName):
			writeErr(w, http.StatusBadRequest, err.Error())
		default:
			slog.Error("register", "err", err)
			writeErr(w, http.StatusInternalServerError, "could not create account")
		}
		return
	}
	setSessionCookie(w, token)
	writeJSON(w, http.StatusCreated, struct {
		User User `json:"user"`
	}{user})
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	ip := clientIP(r)
	if !a.accounts.limiter.allow(ip) {
		writeErr(w, http.StatusTooManyRequests, "too many login attempts")
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &req, 1<<20); err != nil {
		writeDecodeErr(w, err)
		return
	}
	user, token, err := a.accounts.Login(req.Email, req.Password)
	if err != nil {
		if errors.Is(err, errBadCredentials) {
			writeErr(w, http.StatusUnauthorized, err.Error())
		} else {
			slog.Error("login", "err", err)
			writeErr(w, http.StatusInternalServerError, "could not sign in")
		}
		return
	}
	a.accounts.limiter.reset(ip)
	setSessionCookie(w, token)
	writeJSON(w, http.StatusOK, struct {
		User User `json:"user"`
	}{user})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	a.accounts.Logout(sessionToken(r))
	clearSessionCookie(w)
	writeJSON(w, http.StatusOK, struct {
		OK bool `json:"ok"`
	}{true})
}

func (a *API) me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	user, ok := a.accounts.Authenticate(sessionToken(r))
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	st, err := a.accounts.Store(user.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		User  User  `json:"user"`
		Usage Usage `json:"usage"`
	}{user, st.Usage(a.quotaLimit(user))})
}

func (a *API) quotaLimit(user User) int64 {
	return a.accounts.limitFor(user.Plan)
}

func sessionToken(r *http.Request) string {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return ""
	}
	return c.Value
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(sessionTTL / time.Second),
		Expires:  time.Now().Add(sessionTTL),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

// ---- files ----

type createFileReq struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Doc       json.RawMessage `json:"doc"`
	Thumbnail string          `json:"thumbnail"`
	Draft     bool            `json:"draft"`
}

type updateFileReq struct {
	Name      *string          `json:"name"`
	Doc       *json.RawMessage `json:"doc"`
	Thumbnail *string          `json:"thumbnail"`
	Pinned    *bool            `json:"pinned"`
	Draft     *bool            `json:"draft"`
}

func (a *API) files(w http.ResponseWriter, r *http.Request, tail []string) {
	ai := authFrom(r)
	if ai == nil {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	switch len(tail) {
	case 0:
		switch r.Method {
		case http.MethodGet:
			a.listFiles(w, ai.user)
		case http.MethodPost:
			a.createFile(w, r, ai.user)
		default:
			methodNotAllowed(w, "GET, POST")
		}
	case 1:
		a.file(w, r, ai.user, tail[0])
	case 2:
		a.fileAction(w, r, ai.user, tail[0], tail[1])
	default:
		writeErr(w, http.StatusNotFound, "not found")
	}
}

func (a *API) listFiles(w http.ResponseWriter, user User) {
	st, err := a.accounts.Store(user.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	files, err := st.ListFiles()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "cannot read files")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Files []FileMeta `json:"files"`
	}{files})
}

func (a *API) createFile(w http.ResponseWriter, r *http.Request, user User) {
	var req createFileReq
	if err := decodeJSON(w, r, &req, maxBody); err != nil {
		writeDecodeErr(w, err)
		return
	}
	name, err := cleanName(req.Name, "Untitled")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid name")
		return
	}
	doc, err := normalizeDoc(req.Doc)
	if err != nil {
		writeDocErr(w, err)
		return
	}
	id := req.ID
	if id == "" {
		id, err = newID()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "cannot generate id")
			return
		}
	} else if !validID(id) {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	now := nowMillis()
	f := &File{
		FileMeta: FileMeta{
			ID:        id,
			Name:      name,
			CreatedAt: now,
			UpdatedAt: now,
			Draft:     req.Draft,
			HasThumb:  hasThumb(req.Thumbnail),
		},
		Doc:       doc,
		Thumbnail: req.Thumbnail,
	}
	st, err := a.accounts.Store(user.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	if err := st.CreateFile(f, a.quotaLimit(user)); err != nil {
		if errors.Is(err, errQuota) {
			a.writeQuota(w, user, st)
			return
		}
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, f.FileMeta)
}

func (a *API) file(w http.ResponseWriter, r *http.Request, user User, id string) {
	if !validID(id) {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	st, err := a.accounts.Store(user.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	switch r.Method {
	case http.MethodGet:
		f, err := st.GetFile(id)
		if err != nil {
			writeStoreErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			FileMeta
			Doc json.RawMessage `json:"doc"`
		}{f.FileMeta, f.Doc})
	case http.MethodPut:
		a.updateFile(w, r, user, st, id)
	case http.MethodDelete:
		if err := st.DeleteFile(id); err != nil {
			writeStoreErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			OK bool `json:"ok"`
		}{true})
	default:
		methodNotAllowed(w, "GET, PUT, DELETE")
	}
}

func (a *API) updateFile(w http.ResponseWriter, r *http.Request, user User, st *Store, id string) {
	var req updateFileReq
	if err := decodeJSON(w, r, &req, maxBody); err != nil {
		writeDecodeErr(w, err)
		return
	}
	var name string
	if req.Name != nil {
		var err error
		name, err = cleanName(*req.Name, "")
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid name")
			return
		}
	}
	var doc json.RawMessage
	if req.Doc != nil {
		var err error
		doc, err = normalizeDoc(*req.Doc)
		if err != nil {
			writeDocErr(w, err)
			return
		}
	}
	f, err := st.UpsertFile(id, func(f *File) error {
		if req.Name != nil {
			f.Name = name
		}
		if req.Doc != nil {
			f.Doc = doc
		}
		if req.Thumbnail != nil {
			f.Thumbnail = *req.Thumbnail
		}
		if req.Pinned != nil {
			f.Pinned = *req.Pinned
		}
		if req.Draft != nil {
			f.Draft = *req.Draft
		}
		f.UpdatedAt = nowMillis()
		return nil
	}, a.quotaLimit(user))
	if err != nil {
		if errors.Is(err, errQuota) {
			a.writeQuota(w, user, st)
			return
		}
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, f.FileMeta)
}

func (a *API) fileAction(w http.ResponseWriter, r *http.Request, user User, id, action string) {
	if !validID(id) {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	st, err := a.accounts.Store(user.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	switch action {
	case "duplicate":
		if r.Method != http.MethodPost {
			methodNotAllowed(w, "POST")
			return
		}
		f, err := st.DuplicateFile(id, a.quotaLimit(user))
		if err != nil {
			if errors.Is(err, errQuota) {
				a.writeQuota(w, user, st)
				return
			}
			writeStoreErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			File FileMeta `json:"file"`
		}{f.FileMeta})
	case "pin":
		if r.Method != http.MethodPost {
			methodNotAllowed(w, "POST")
			return
		}
		var req struct {
			Pinned *bool `json:"pinned"`
		}
		if err := decodeJSON(w, r, &req, 1<<20); err != nil {
			writeDecodeErr(w, err)
			return
		}
		if req.Pinned == nil {
			writeErr(w, http.StatusBadRequest, "pinned is required")
			return
		}
		f, err := st.UpdateFile(id, func(f *File) error {
			f.Pinned = *req.Pinned
			return nil
		}, a.quotaLimit(user))
		if err != nil {
			if errors.Is(err, errQuota) {
				a.writeQuota(w, user, st)
				return
			}
			writeStoreErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, f.FileMeta)
	case "thumb":
		if r.Method != http.MethodGet {
			methodNotAllowed(w, "GET")
			return
		}
		a.thumb(w, st, id)
	default:
		writeErr(w, http.StatusNotFound, "not found")
	}
}

func (a *API) thumb(w http.ResponseWriter, st *Store, id string) {
	f, err := st.GetFile(id)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	data, err := decodePNGDataURL(f.Thumbnail)
	if err != nil {
		writeErr(w, http.StatusNotFound, "no thumbnail")
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

var pngMagic = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

func decodePNGDataURL(s string) ([]byte, error) {
	header, payload, ok := strings.Cut(s, ",")
	if !ok {
		return nil, errInvalid
	}
	h := strings.ToLower(header)
	if !strings.HasPrefix(h, "data:image/png") || !strings.Contains(h, ";base64") {
		return nil, errInvalid
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil || !bytes.HasPrefix(data, pngMagic) {
		return nil, errInvalid
	}
	return data, nil
}

// ---- assets ----

func (a *API) assets(w http.ResponseWriter, r *http.Request) {
	ai := authFrom(r)
	if ai == nil {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	st, err := a.accounts.Store(ai.user.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, struct {
			Assets []AssetMeta `json:"assets"`
		}{st.ListAssets()})
	case http.MethodPost:
		a.uploadAsset(w, r, ai.user, st)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func (a *API) uploadAsset(w http.ResponseWriter, r *http.Request, user User, st *Store) {
	limit := a.quotaLimit(user)
	if limit > 0 {
		usage := st.Usage(limit)
		remaining := limit - usage.UsedBytes
		if remaining < 0 {
			remaining = 0
		}
		// Cheap early rejection before buffering an obviously oversized upload.
		if r.ContentLength > 0 && r.ContentLength > remaining+(1<<20) {
			a.writeQuotaUsage(w, user, usage)
			return
		}
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUpload+(1<<20))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeErr(w, http.StatusRequestEntityTooLarge, "asset too large")
			return
		}
		writeErr(w, http.StatusBadRequest, "invalid multipart form")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	part, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "file field required")
		return
	}
	defer part.Close()

	data, err := io.ReadAll(io.LimitReader(part, maxUpload+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "cannot read file")
		return
	}
	if len(data) == 0 {
		writeErr(w, http.StatusBadRequest, "empty file")
		return
	}
	if len(data) > maxUpload {
		writeErr(w, http.StatusRequestEntityTooLarge, "asset too large")
		return
	}
	contentType, ok := detectAssetType(header.Filename, data)
	if !ok {
		writeErr(w, http.StatusBadRequest, "unsupported file type")
		return
	}
	id, err := newID()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "cannot generate id")
		return
	}
	meta := AssetMeta{
		ID:        id,
		Name:      cleanAssetName(header.Filename),
		Type:      contentType,
		URL:       "/api/assets/" + id,
		Size:      int64(len(data)),
		CreatedAt: nowMillis(),
	}
	if err := st.AddAsset(meta, data, limit); err != nil {
		if errors.Is(err, errQuota) {
			a.writeQuota(w, user, st)
			return
		}
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, meta)
}

func (a *API) asset(w http.ResponseWriter, r *http.Request, id string) {
	ai := authFrom(r)
	if ai == nil {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !validID(id) {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	st, err := a.accounts.Store(ai.user.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	switch r.Method {
	case http.MethodGet:
		meta, data, err := st.GetAsset(id)
		if err != nil {
			writeStoreErr(w, err)
			return
		}
		h := w.Header()
		h.Set("Content-Type", meta.Type)
		h.Set("Content-Length", strconv.Itoa(len(data)))
		h.Set("X-Content-Type-Options", "nosniff")
		if meta.Type == "image/svg+xml" {
			h.Set("Content-Security-Policy", "sandbox")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	case http.MethodDelete:
		if err := st.DeleteAsset(id); err != nil {
			writeStoreErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			OK bool `json:"ok"`
		}{true})
	default:
		methodNotAllowed(w, "GET, DELETE")
	}
}

func cleanAssetName(name string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.TrimSpace(truncateName(name))
	if name == "" || name == "." {
		return "asset"
	}
	return name
}

func detectAssetType(name string, data []byte) (string, bool) {
	lower := bytes.ToLower(data)
	if len(lower) > 2048 {
		lower = lower[:2048]
	}
	ext := strings.ToLower(path.Ext(name))
	switch {
	case bytes.HasPrefix(data, pngMagic):
		return "image/png", true
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "image/jpeg", true
	case len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
		return "image/gif", true
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp", true
	case len(data) >= 12 && string(data[4:8]) == "ftyp" &&
		(string(data[8:12]) == "avif" || string(data[8:12]) == "avis"):
		return "image/avif", true
	case ext == ".svg" && bytes.Contains(lower, []byte("<svg")):
		return "image/svg+xml", true
	}
	return "", false
}

// ---- settings ----

func (a *API) settings(w http.ResponseWriter, r *http.Request) {
	ai := authFrom(r)
	if ai == nil {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	st, err := a.accounts.Store(ai.user.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	switch r.Method {
	case http.MethodGet:
		raw := st.GetSettings()
		if raw == nil {
			raw = json.RawMessage("null")
		}
		writeJSON(w, http.StatusOK, struct {
			Settings json.RawMessage `json:"settings"`
		}{raw})
	case http.MethodPut:
		body, err := readLimited(w, r, 1<<20)
		if err != nil {
			writeDecodeErr(w, err)
			return
		}
		var obj map[string]json.RawMessage
		if err := json.Unmarshal(body, &obj); err != nil || obj == nil {
			writeErr(w, http.StatusBadRequest, "settings must be a JSON object")
			return
		}
		raw := json.RawMessage(bytes.TrimSpace(body))
		if err := st.SetSettings(raw); err != nil {
			writeStoreErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			OK bool `json:"ok"`
		}{true})
	default:
		methodNotAllowed(w, "GET, PUT")
	}
}

// ---- account ----

func (a *API) account(w http.ResponseWriter, r *http.Request) {
	ai := authFrom(r)
	if ai == nil {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, "DELETE")
		return
	}
	var req struct {
		Confirm bool `json:"confirm"`
	}
	if err := decodeJSON(w, r, &req, 1<<20); err != nil {
		writeDecodeErr(w, err)
		return
	}
	if !req.Confirm {
		writeErr(w, http.StatusBadRequest, "confirm must be true")
		return
	}
	if err := a.accounts.DeleteUser(ai.user.ID); err != nil {
		writeStoreErr(w, err)
		return
	}
	clearSessionCookie(w)
	writeJSON(w, http.StatusOK, struct {
		OK bool `json:"ok"`
	}{true})
}

func (a *API) accountAction(w http.ResponseWriter, r *http.Request, action string) {
	ai := authFrom(r)
	if ai == nil {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	switch action {
	case "usage":
		if r.Method != http.MethodGet {
			methodNotAllowed(w, "GET")
			return
		}
		st, err := a.accounts.Store(ai.user.ID)
		if err != nil {
			writeStoreErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Usage Usage `json:"usage"`
		}{st.Usage(a.quotaLimit(ai.user))})
	case "plan":
		if r.Method != http.MethodPost {
			methodNotAllowed(w, "POST")
			return
		}
		var req struct {
			Plan string `json:"plan"`
		}
		if err := decodeJSON(w, r, &req, 1<<20); err != nil {
			writeDecodeErr(w, err)
			return
		}
		user, err := a.accounts.SetPlan(ai.user.ID, req.Plan)
		if err != nil {
			if errors.Is(err, errInvalidPlan) {
				writeErr(w, http.StatusBadRequest, err.Error())
			} else {
				writeStoreErr(w, err)
			}
			return
		}
		st, err := a.accounts.Store(user.ID)
		if err != nil {
			writeStoreErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			User  User  `json:"user"`
			Usage Usage `json:"usage"`
		}{user, st.Usage(a.quotaLimit(user))})
	default:
		writeErr(w, http.StatusNotFound, "not found")
	}
}

func (a *API) writeQuota(w http.ResponseWriter, user User, st *Store) {
	a.writeQuotaUsage(w, user, st.Usage(a.quotaLimit(user)))
}

func (a *API) writeQuotaUsage(w http.ResponseWriter, user User, usage Usage) {
	writeJSON(w, http.StatusPaymentRequired, struct {
		Error      string `json:"error"`
		Usage      Usage  `json:"usage"`
		LimitBytes int64  `json:"limitBytes"`
		Plan       string `json:"plan"`
	}{"quota_exceeded", usage, usage.LimitBytes, user.Plan})
}

// ---- frontend ----

func (a *API) serveWeb(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name != "" {
		if st, err := fs.Stat(a.web, name); err == nil && !st.IsDir() {
			a.static.ServeHTTP(w, r)
			return
		}
	}
	index, err := fs.ReadFile(a.web, "index.html")
	if err != nil {
		http.Error(w, "frontend not built", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(index)
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, struct {
		Error string `json:"error"`
	}{message})
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
}

func writeStoreErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, errInvalid):
		writeErr(w, http.StatusBadRequest, "invalid id")
	case errors.Is(err, errExists):
		writeErr(w, http.StatusConflict, "file already exists")
	case errors.Is(err, errQuota):
		writeErr(w, http.StatusPaymentRequired, "quota_exceeded")
	default:
		slog.Error("store", "err", err)
		writeErr(w, http.StatusInternalServerError, "storage error")
	}
}

func writeDocErr(w http.ResponseWriter, err error) {
	if errors.Is(err, errDocTooLarge) {
		writeErr(w, http.StatusRequestEntityTooLarge, "document too large")
		return
	}
	writeErr(w, http.StatusBadRequest, "doc must be a JSON object")
}

func writeDecodeErr(w http.ResponseWriter, err error) {
	var mbe *http.MaxBytesError
	if errors.As(err, &mbe) {
		writeErr(w, http.StatusRequestEntityTooLarge, "request body too large")
		return
	}
	writeErr(w, http.StatusBadRequest, "invalid JSON")
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	return json.NewDecoder(r.Body).Decode(v)
}

func readLimited(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	return io.ReadAll(r.Body)
}

func cleanName(name, fallback string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = fallback
	}
	if name == "" || nameLen(name) > maxName {
		return "", errInvalid
	}
	return name, nil
}

var errDocTooLarge = errors.New("document too large")

func normalizeDoc(raw json.RawMessage) (json.RawMessage, error) {
	b := bytes.TrimSpace(raw)
	if len(b) == 0 {
		return json.RawMessage(`{}`), nil
	}
	if len(b) > maxDoc {
		return nil, errDocTooLarge
	}
	if b[0] != '{' || !json.Valid(b) {
		return nil, errInvalid
	}
	return append(json.RawMessage(nil), b...), nil
}

type recorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (r *recorder) WriteHeader(status int) {
	if r.wrote {
		return
	}
	r.status = status
	r.wrote = true
	r.ResponseWriter.WriteHeader(status)
}

func (r *recorder) Write(b []byte) (int, error) {
	if !r.wrote {
		r.WriteHeader(http.StatusOK)
	}
	return r.ResponseWriter.Write(b)
}

func (r *recorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }
