package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	planFree      = "free"
	planPro       = "pro"
	cookieName    = "penclone_session"
	sessionTTL    = 30 * 24 * time.Hour
	pbkdf2Rounds  = 210_000
	pbkdf2SaltLen = 16
	pbkdf2KeyLen  = 32
	loginMax      = 10
	loginWindow   = time.Minute
)

// User is the public account shape. Password material never leaves user.json.
type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	Name         string `json:"name"`
	Plan         string `json:"plan"`
	CreatedAt    int64  `json:"createdAt"`
	HasPassword  bool   `json:"hasPassword"`
	GoogleLinked bool   `json:"googleLinked"`
}

type userRecord struct {
	User
	Salt      string `json:"salt"`
	Hash      string `json:"hash"`
	GoogleSub string `json:"googleSub,omitempty"`
}

type session struct {
	UserID    string `json:"userId"`
	ExpiresAt int64  `json:"expiresAt"`
}

var (
	errEmailTaken     = errors.New("email already registered")
	errBadCredentials = errors.New("invalid email or password")
	errInvalidEmail   = errors.New("invalid email")
	errWeakPassword   = errors.New("password must be at least 8 characters")
	errInvalidName    = errors.New("name must be 1 to 80 characters")
	errInvalidPlan    = errors.New("plan must be free or pro")
	errGoogleConflict = errors.New("google account is already linked elsewhere")
)

// Accounts owns the user index, sessions, per-user stores and login limiter.
type Accounts struct {
	root         string
	usersDir     string
	usersPath    string
	sessionsPath string
	legacyDir    string
	FreeQuota    int64

	mu       sync.Mutex
	users    []User
	sessions map[string]session

	storesMu sync.Mutex
	stores   map[string]*Store

	limiter *loginLimiter
}

func NewAccounts(root string, freeQuota int64) (*Accounts, error) {
	if freeQuota <= 0 {
		return nil, errors.New("free quota must be positive")
	}
	a := &Accounts{
		root:         root,
		usersDir:     filepath.Join(root, "users"),
		usersPath:    filepath.Join(root, "users.json"),
		sessionsPath: filepath.Join(root, "sessions.json"),
		legacyDir:    filepath.Join(root, "legacy"),
		FreeQuota:    freeQuota,
		sessions:     map[string]session{},
		stores:       map[string]*Store{},
		limiter:      newLoginLimiter(),
	}
	if err := os.MkdirAll(a.usersDir, 0o755); err != nil {
		return nil, err
	}
	if b, err := os.ReadFile(a.usersPath); err == nil {
		var list []User
		if json.Unmarshal(b, &list) == nil {
			for _, u := range list {
				if !validID(u.ID) {
					continue
				}
				if u.Plan != planPro {
					u.Plan = planFree
				}
				a.users = append(a.users, u)
			}
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	pruned := false
	if b, err := os.ReadFile(a.sessionsPath); err == nil {
		var list map[string]session
		if json.Unmarshal(b, &list) == nil {
			now := nowMillis()
			for hash, s := range list {
				if s.UserID == "" || s.ExpiresAt <= now {
					pruned = true
					continue
				}
				a.sessions[hash] = s
			}
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	if pruned {
		_ = a.saveSessionsLocked()
	}
	return a, nil
}

func (a *Accounts) limitFor(plan string) int64 {
	if plan == planPro {
		return 0
	}
	return a.FreeQuota
}

// Store returns the lazily-created per-user store.
func (a *Accounts) Store(userID string) (*Store, error) {
	if !validID(userID) {
		return nil, errInvalid
	}
	a.storesMu.Lock()
	defer a.storesMu.Unlock()
	if st := a.stores[userID]; st != nil {
		return st, nil
	}
	st, err := NewStore(filepath.Join(a.usersDir, userID))
	if err != nil {
		return nil, err
	}
	a.stores[userID] = st
	return st, nil
}

func (a *Accounts) dropStore(userID string) {
	a.storesMu.Lock()
	delete(a.stores, userID)
	a.storesMu.Unlock()
}

// Counts returns global file/asset totals for the public health endpoint.
func (a *Accounts) Counts() (int, int) {
	a.mu.Lock()
	ids := make([]string, 0, len(a.users))
	for _, u := range a.users {
		ids = append(ids, u.ID)
	}
	a.mu.Unlock()
	files, assets := 0, 0
	for _, id := range ids {
		dir := filepath.Join(a.usersDir, id)
		if entries, err := os.ReadDir(filepath.Join(dir, "files")); err == nil {
			for _, e := range entries {
				if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
					files++
				}
			}
		}
		if b, err := os.ReadFile(filepath.Join(dir, "assets", "index.json")); err == nil {
			var list []AssetMeta
			if json.Unmarshal(b, &list) == nil {
				assets += len(list)
			}
		}
	}
	return files, assets
}

func (a *Accounts) Register(email, password, name string) (User, string, error) {
	email = normalizeEmail(email)
	name = strings.TrimSpace(name)
	if !validEmail(email) {
		return User{}, "", errInvalidEmail
	}
	if utf8.RuneCountInString(password) < 8 {
		return User{}, "", errWeakPassword
	}
	if n := utf8.RuneCountInString(name); n < 1 || n > 80 {
		return User{}, "", errInvalidName
	}

	salt := make([]byte, pbkdf2SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return User{}, "", err
	}
	hash := pbkdf2Key([]byte(password), salt, pbkdf2Rounds, pbkdf2KeyLen)

	a.mu.Lock()
	defer a.mu.Unlock()
	for _, u := range a.users {
		if strings.EqualFold(u.Email, email) {
			return User{}, "", errEmailTaken
		}
	}
	id, err := a.freeUserIDLocked()
	if err != nil {
		return User{}, "", err
	}
	now := nowMillis()
	rec := userRecord{
		User: User{ID: id, Email: email, Name: name, Plan: planFree, CreatedAt: now, HasPassword: true},
		Salt: base64.StdEncoding.EncodeToString(salt),
		Hash: base64.StdEncoding.EncodeToString(hash),
	}
	userDir := filepath.Join(a.usersDir, id)
	for _, dir := range []string{userDir, filepath.Join(userDir, "files"), filepath.Join(userDir, "assets")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return User{}, "", err
		}
	}
	if err := a.writeUserRecordLocked(&rec); err != nil {
		return User{}, "", err
	}

	first := len(a.users) == 0
	next := make([]User, len(a.users), len(a.users)+1)
	copy(next, a.users)
	next = append(next, rec.User)
	if err := a.saveUsersLocked(next); err != nil {
		_ = os.RemoveAll(userDir)
		return User{}, "", err
	}
	a.users = next

	if first {
		if err := a.migrateLegacyLocked(id); err != nil {
			slog.Error("legacy migration failed", "userId", id, "err", err)
		}
	}
	token, err := a.newSessionLocked(id)
	if err != nil {
		return User{}, "", err
	}
	return rec.User, token, nil
}

func (a *Accounts) Login(email, password string) (User, string, error) {
	email = normalizeEmail(email)
	a.mu.Lock()
	var rec *userRecord
	for _, u := range a.users {
		if strings.EqualFold(u.Email, email) {
			r, err := a.readUserRecordLocked(u.ID)
			if err == nil {
				rec = r
			}
			break
		}
	}
	a.mu.Unlock()

	if rec == nil {
		// Spend comparable time even for unknown emails.
		_ = pbkdf2Key([]byte(password), []byte("penclone-dummy!"), pbkdf2Rounds, pbkdf2KeyLen)
		return User{}, "", errBadCredentials
	}
	if !rec.HasPassword || !verifyPassword(rec, password) {
		return User{}, "", errBadCredentials
	}
	a.mu.Lock()
	token, err := a.newSessionLocked(rec.ID)
	a.mu.Unlock()
	if err != nil {
		return User{}, "", err
	}
	return rec.User, token, nil
}

// LoginGoogle resolves a verified Google identity to a local account, links by
// email when possible, or creates a passwordless Free account.
func (a *Accounts) LoginGoogle(identity GoogleIdentity) (User, string, error) {
	sub := strings.TrimSpace(identity.Sub)
	email := normalizeEmail(identity.Email)
	name := strings.TrimSpace(identity.Name)
	if sub == "" || len(sub) > 255 || !validEmail(email) {
		return User{}, "", errBadCredentials
	}
	if name == "" {
		name = emailLocalName(email)
	}
	name = clampUserName(name)
	if name == "" {
		name = "Google User"
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	// Existing Google subject wins.
	for i := range a.users {
		rec, err := a.readUserRecordLocked(a.users[i].ID)
		if err != nil || rec.GoogleSub != sub {
			continue
		}
		token, err := a.newSessionLocked(rec.ID)
		if err != nil {
			return User{}, "", err
		}
		return rec.User, token, nil
	}

	// Otherwise link a verified Google email to an existing password account.
	for i := range a.users {
		if !strings.EqualFold(a.users[i].Email, email) {
			continue
		}
		rec, err := a.readUserRecordLocked(a.users[i].ID)
		if err != nil {
			return User{}, "", err
		}
		if rec.GoogleSub != "" && rec.GoogleSub != sub {
			return User{}, "", errGoogleConflict
		}
		rec.GoogleSub = sub
		rec.User.GoogleLinked = true
		if err := a.writeUserRecordLocked(rec); err != nil {
			return User{}, "", err
		}
		a.users[i] = rec.User
		if err := a.saveUsersLocked(a.users); err != nil {
			return User{}, "", err
		}
		token, err := a.newSessionLocked(rec.ID)
		if err != nil {
			return User{}, "", err
		}
		return rec.User, token, nil
	}

	// New Google-only account with an unusable random password hash.
	id, err := a.freeUserIDLocked()
	if err != nil {
		return User{}, "", err
	}
	salt := make([]byte, pbkdf2SaltLen)
	hash := make([]byte, pbkdf2KeyLen)
	if _, err := rand.Read(salt); err != nil {
		return User{}, "", err
	}
	if _, err := rand.Read(hash); err != nil {
		return User{}, "", err
	}
	now := nowMillis()
	rec := userRecord{
		User: User{
			ID: id, Email: email, Name: name, Plan: planFree, CreatedAt: now,
			HasPassword: false, GoogleLinked: true,
		},
		Salt:      base64.StdEncoding.EncodeToString(salt),
		Hash:      base64.StdEncoding.EncodeToString(hash),
		GoogleSub: sub,
	}
	userDir := filepath.Join(a.usersDir, id)
	for _, dir := range []string{userDir, filepath.Join(userDir, "files"), filepath.Join(userDir, "assets")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return User{}, "", err
		}
	}
	if err := a.writeUserRecordLocked(&rec); err != nil {
		_ = os.RemoveAll(userDir)
		return User{}, "", err
	}
	first := len(a.users) == 0
	next := make([]User, len(a.users), len(a.users)+1)
	copy(next, a.users)
	next = append(next, rec.User)
	if err := a.saveUsersLocked(next); err != nil {
		_ = os.RemoveAll(userDir)
		return User{}, "", err
	}
	a.users = next
	if first {
		if err := a.migrateLegacyLocked(id); err != nil {
			slog.Error("legacy migration failed", "userId", id, "err", err)
		}
	}
	token, err := a.newSessionLocked(id)
	if err != nil {
		return User{}, "", err
	}
	return rec.User, token, nil
}

func emailLocalName(email string) string {
	if at := strings.IndexByte(email, '@'); at > 0 {
		return email[:at]
	}
	return ""
}

func clampUserName(name string) string {
	r := []rune(name)
	if len(r) > 80 {
		r = r[:80]
	}
	return string(r)
}

func (a *Accounts) Authenticate(token string) (User, bool) {
	if token == "" {
		return User{}, false
	}
	hash := tokenHash(token)
	a.mu.Lock()
	s, ok := a.sessions[hash]
	if ok && s.ExpiresAt <= nowMillis() {
		delete(a.sessions, hash)
		_ = a.saveSessionsLocked()
		ok = false
	}
	a.mu.Unlock()
	if !ok {
		return User{}, false
	}
	rec, err := a.UserByID(s.UserID)
	if err != nil {
		a.deleteSession(token)
		return User{}, false
	}
	return rec, true
}

func (a *Accounts) UserByID(id string) (User, error) {
	if !validID(id) {
		return User{}, errNotFound
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	rec, err := a.readUserRecordLocked(id)
	if err != nil {
		return User{}, err
	}
	return rec.User, nil
}

func (a *Accounts) Logout(token string) {
	if token == "" {
		return
	}
	a.deleteSession(token)
}

func (a *Accounts) deleteSession(token string) {
	hash := tokenHash(token)
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.sessions[hash]; !ok {
		return
	}
	delete(a.sessions, hash)
	_ = a.saveSessionsLocked()
}

func (a *Accounts) SetPlan(userID, plan string) (User, error) {
	if plan != planFree && plan != planPro {
		return User{}, errInvalidPlan
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	rec, err := a.readUserRecordLocked(userID)
	if err != nil {
		return User{}, err
	}
	rec.Plan = plan
	if err := a.writeUserRecordLocked(rec); err != nil {
		return User{}, err
	}
	found := false
	for i := range a.users {
		if a.users[i].ID == userID {
			a.users[i].Plan = plan
			found = true
			break
		}
	}
	if !found {
		return User{}, errNotFound
	}
	if err := a.saveUsersLocked(a.users); err != nil {
		return User{}, err
	}
	slog.Info("plan changed", "userId", userID, "plan", plan)
	return rec.User, nil
}

func (a *Accounts) DeleteUser(userID string) error {
	if !validID(userID) {
		return errInvalid
	}
	a.mu.Lock()
	idx := -1
	for i, u := range a.users {
		if u.ID == userID {
			idx = i
			break
		}
	}
	if idx < 0 {
		a.mu.Unlock()
		return errNotFound
	}
	userDir := filepath.Join(a.usersDir, userID)
	trash := filepath.Join(a.usersDir, ".deleted-"+userID+"-"+time.Now().Format("20060102150405.000000000"))
	if err := os.Rename(userDir, trash); err != nil && !errors.Is(err, fs.ErrNotExist) {
		a.mu.Unlock()
		return err
	}
	next := make([]User, 0, len(a.users)-1)
	next = append(next, a.users[:idx]...)
	next = append(next, a.users[idx+1:]...)
	if err := a.saveUsersLocked(next); err != nil {
		_ = os.Rename(trash, userDir)
		a.mu.Unlock()
		return err
	}
	a.users = next
	removedSessions := 0
	for hash, s := range a.sessions {
		if s.UserID == userID {
			delete(a.sessions, hash)
			removedSessions++
		}
	}
	if removedSessions > 0 {
		if err := a.saveSessionsLocked(); err != nil {
			slog.Error("save sessions after account delete", "err", err)
		}
	}
	a.mu.Unlock()
	a.dropStore(userID)
	if err := os.RemoveAll(trash); err != nil {
		slog.Error("remove account data", "userId", userID, "path", trash, "err", err)
	}
	slog.Info("account deleted", "userId", userID, "sessions", removedSessions)
	return nil
}

// ---- user records / sessions (call with a.mu held where required) ----

func (a *Accounts) userPath(id string) (string, error) {
	if !validID(id) {
		return "", errInvalid
	}
	return filepath.Join(a.usersDir, id), nil
}

func (a *Accounts) writeUserRecordLocked(rec *userRecord) error {
	dir, err := a.userPath(rec.ID)
	if err != nil {
		return err
	}
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(dir, "user.json"), data)
}

func (a *Accounts) readUserRecordLocked(id string) (*userRecord, error) {
	dir, err := a.userPath(id)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(filepath.Join(dir, "user.json"))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, errNotFound
		}
		return nil, err
	}
	var rec userRecord
	if err := json.Unmarshal(b, &rec); err != nil {
		return nil, err
	}
	if rec.ID != id {
		return nil, errNotFound
	}
	if rec.GoogleSub != "" {
		rec.User.GoogleLinked = true
	}
	if !rec.User.HasPassword && rec.GoogleSub == "" && rec.Hash != "" {
		rec.User.HasPassword = true
	}
	return &rec, nil
}

func (a *Accounts) saveUsersLocked(list []User) error {
	data, err := json.Marshal(list)
	if err != nil {
		return err
	}
	return writeAtomic(a.usersPath, data)
}

func (a *Accounts) saveSessionsLocked() error {
	data, err := json.Marshal(a.sessions)
	if err != nil {
		return err
	}
	return writeAtomic(a.sessionsPath, data)
}

func (a *Accounts) newSessionLocked(userID string) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	hash := tokenHash(token)
	a.sessions[hash] = session{UserID: userID, ExpiresAt: nowMillis() + sessionTTL.Milliseconds()}
	if err := a.saveSessionsLocked(); err != nil {
		delete(a.sessions, hash)
		return "", err
	}
	return token, nil
}

func (a *Accounts) freeUserIDLocked() (string, error) {
	for i := 0; i < 8; i++ {
		id, err := newID()
		if err != nil {
			return "", err
		}
		exists := false
		for _, u := range a.users {
			if u.ID == id {
				exists = true
				break
			}
		}
		if !exists {
			return id, nil
		}
	}
	return "", errors.New("could not allocate user id")
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func verifyPassword(rec *userRecord, password string) bool {
	salt, err := base64.StdEncoding.DecodeString(rec.Salt)
	if err != nil {
		return false
	}
	expected, err := base64.StdEncoding.DecodeString(rec.Hash)
	if err != nil {
		return false
	}
	actual := pbkdf2Key([]byte(password), salt, pbkdf2Rounds, len(expected))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

// pbkdf2Key implements PBKDF2-HMAC-SHA256 with the stdlib only.
func pbkdf2Key(password, salt []byte, iterations, keyLen int) []byte {
	const hashLen = sha256.Size
	blocks := (keyLen + hashLen - 1) / hashLen
	out := make([]byte, 0, blocks*hashLen)
	var counter [4]byte
	for block := 1; block <= blocks; block++ {
		counter[0] = byte(block >> 24)
		counter[1] = byte(block >> 16)
		counter[2] = byte(block >> 8)
		counter[3] = byte(block)
		mac := hmac.New(sha256.New, password)
		mac.Write(salt)
		mac.Write(counter[:])
		u := mac.Sum(nil)
		t := make([]byte, len(u))
		copy(t, u)
		for i := 1; i < iterations; i++ {
			mac = hmac.New(sha256.New, password)
			mac.Write(u)
			u = mac.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

// ---- validation ----

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func validEmail(email string) bool {
	if len(email) < 3 || len(email) > 254 {
		return false
	}
	at := strings.IndexByte(email, '@')
	if at <= 0 || at == len(email)-1 {
		return false
	}
	domain := email[at+1:]
	if strings.Contains(domain, "@") || !strings.Contains(domain, ".") ||
		strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") {
		return false
	}
	return !strings.ContainsAny(email, " \t\r\n")
}

// ---- legacy migration ----

func (a *Accounts) migrateLegacyLocked(userID string) error {
	srcFiles := filepath.Join(a.root, "files")
	srcAssets := filepath.Join(a.root, "assets")
	userDir := filepath.Join(a.usersDir, userID)
	files, err := moveDirContents(srcFiles, filepath.Join(userDir, "files"), filepath.Join(a.legacyDir, userID))
	if err != nil {
		return err
	}
	assets, err := moveDirContents(srcAssets, filepath.Join(userDir, "assets"), filepath.Join(a.legacyDir, userID))
	if err != nil {
		return err
	}
	settings := 0
	srcSettings := filepath.Join(a.root, "settings.json")
	if _, err := os.Stat(srcSettings); err == nil {
		dst := filepath.Join(userDir, "settings.json")
		if _, err := os.Stat(dst); errors.Is(err, fs.ErrNotExist) {
			if err := os.Rename(srcSettings, dst); err != nil {
				return err
			}
		} else {
			dst = conflictPath(filepath.Join(a.legacyDir, userID), "settings.json")
			if err := os.Rename(srcSettings, dst); err != nil {
				return err
			}
		}
		settings = 1
	}
	if files+assets+settings > 0 {
		slog.Info("legacy data migrated", "userId", userID, "files", files, "assets", assets, "settings", settings)
	}
	return nil
}

func moveDirContents(src, dst, conflictDir string) (int, error) {
	entries, err := os.ReadDir(src)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return 0, err
	}
	moved := 0
	var firstErr error
	for _, e := range entries {
		from := filepath.Join(src, e.Name())
		to := filepath.Join(dst, e.Name())
		if _, err := os.Lstat(to); err == nil {
			to = conflictPath(conflictDir, e.Name())
		}
		if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if err := os.Rename(from, to); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		moved++
	}
	if firstErr == nil {
		_ = os.Remove(src) // only removes an empty directory
	}
	return moved, firstErr
}

func conflictPath(dir, name string) string {
	_ = os.MkdirAll(dir, 0o755)
	target := filepath.Join(dir, name)
	if _, err := os.Lstat(target); errors.Is(err, fs.ErrNotExist) {
		return target
	}
	base := strings.TrimSuffix(name, filepath.Ext(name))
	ext := filepath.Ext(name)
	stamp := time.Now().Format("150405.000000000")
	for i := 1; i < 1000; i++ {
		target = filepath.Join(dir, base+"-"+stamp+"-"+strconv.Itoa(i)+ext)
		if _, err := os.Lstat(target); errors.Is(err, fs.ErrNotExist) {
			return target
		}
	}
	return filepath.Join(dir, ".conflict-"+name)
}

// ---- login rate limit ----

type loginLimiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{attempts: map[string][]time.Time{}}
}

func (l *loginLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-loginWindow)
	list := l.attempts[ip][:0]
	for _, t := range l.attempts[ip] {
		if t.After(cutoff) {
			list = append(list, t)
		}
	}
	if len(list) >= loginMax {
		l.attempts[ip] = list
		return false
	}
	l.attempts[ip] = append(list, now)
	return true
}

func (l *loginLimiter) reset(ip string) {
	l.mu.Lock()
	delete(l.attempts, ip)
	l.mu.Unlock()
}
