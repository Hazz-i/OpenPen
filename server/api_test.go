package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"io/fs"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

const testPassword = "correct horse battery"

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	os.Exit(m.Run())
}

type testEnv struct {
	t        *testing.T
	root     string
	quota    int64
	accounts *Accounts
	api      *API
	srv      *httptest.Server
	jar      http.CookieJar
	client   *http.Client
}

func testWeb() fs.FS {
	return fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<!doctype html><title>pen</title>")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('pen')")},
	}
}

func startEnv(t *testing.T, root string, quota int64, google ...*GoogleOAuth) *testEnv {
	t.Helper()
	accounts, err := NewAccounts(root, quota)
	if err != nil {
		t.Fatalf("NewAccounts: %v", err)
	}
	api := NewAPI(accounts, testWeb(), google...)
	srv := httptest.NewServer(api)
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	env := &testEnv{
		t: t, root: root, quota: quota, accounts: accounts, api: api, srv: srv,
		jar: jar, client: &http.Client{Jar: jar},
	}
	t.Cleanup(srv.Close)
	return env
}

func newEnv(t *testing.T, quota int64) *testEnv {
	t.Helper()
	return startEnv(t, t.TempDir(), quota)
}

func (e *testEnv) do(t *testing.T, c *http.Client, method, target string, body any) (int, []byte, http.Header) {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, e.srv.URL+target, r)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return e.doReq(t, c, req)
}

func (e *testEnv) doRaw(t *testing.T, c *http.Client, method, target, contentType string, body []byte) (int, []byte, http.Header) {
	t.Helper()
	req, err := http.NewRequest(method, e.srv.URL+target, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return e.doReq(t, c, req)
}

func (e *testEnv) doReq(t *testing.T, c *http.Client, req *http.Request) (int, []byte, http.Header) {
	t.Helper()
	resp, err := c.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", req.Method, req.URL.Path, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return resp.StatusCode, data, resp.Header
}

func (e *testEnv) anon() *http.Client { return &http.Client{} }

func (e *testEnv) newClient() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar}
}

func requireCode(t *testing.T, got, want int, body []byte) {
	t.Helper()
	if got != want {
		t.Fatalf("status = %d, want %d; body: %s", got, want, body)
	}
}

func decode[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decode %q: %v", body, err)
	}
	return v
}

func (e *testEnv) signup(t *testing.T, c *http.Client, email string) User {
	t.Helper()
	code, body, _ := e.do(t, c, http.MethodPost, "/api/auth/register", map[string]any{
		"email": email, "password": testPassword, "name": "Test User",
	})
	requireCode(t, code, http.StatusCreated, body)
	return decode[struct {
		User User `json:"user"`
	}](t, body).User
}

func (e *testEnv) login(t *testing.T, c *http.Client, email string) User {
	t.Helper()
	code, body, _ := e.do(t, c, http.MethodPost, "/api/auth/login", map[string]any{
		"email": email, "password": testPassword,
	})
	requireCode(t, code, http.StatusOK, body)
	return decode[struct {
		User User `json:"user"`
	}](t, body).User
}

func (e *testEnv) me(t *testing.T, c *http.Client) (User, Usage) {
	t.Helper()
	code, body, _ := e.do(t, c, http.MethodGet, "/api/auth/me", nil)
	requireCode(t, code, http.StatusOK, body)
	got := decode[struct {
		User  User  `json:"user"`
		Usage Usage `json:"usage"`
	}](t, body)
	return got.User, got.Usage
}

func (e *testEnv) usage(t *testing.T, c *http.Client) Usage {
	t.Helper()
	code, body, _ := e.do(t, c, http.MethodGet, "/api/account/usage", nil)
	requireCode(t, code, http.StatusOK, body)
	return decode[struct {
		Usage Usage `json:"usage"`
	}](t, body).Usage
}

func (e *testEnv) createFile(t *testing.T, c *http.Client, body map[string]any) FileMeta {
	t.Helper()
	code, data, _ := e.do(t, c, http.MethodPost, "/api/files", body)
	requireCode(t, code, http.StatusCreated, data)
	return decode[FileMeta](t, data)
}

func (e *testEnv) upload(t *testing.T, c *http.Client, filename string, data []byte) (int, []byte, http.Header) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("form file: %v", err)
	}
	if _, err := fw.Write(data); err != nil {
		t.Fatalf("form write: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("form close: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, e.srv.URL+"/api/assets", &buf)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return e.doReq(t, c, req)
}

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.RGBA{R: 220, G: 40, B: 90, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png encode: %v", err)
	}
	return buf.Bytes()
}

func pngDataURL(data []byte) string {
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
}

func TestPBKDF2Vector(t *testing.T) {
	got := hex.EncodeToString(pbkdf2Key([]byte("password"), []byte("salt"), 1, 32))
	want := "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
	if got != want {
		t.Fatalf("pbkdf2 = %s, want %s", got, want)
	}
}

func TestHealthPublic(t *testing.T) {
	env := newEnv(t, 5<<30)
	code, body, _ := env.do(t, env.anon(), http.MethodGet, "/api/health", nil)
	requireCode(t, code, http.StatusOK, body)
	got := decode[struct {
		OK           bool   `json:"ok"`
		Version      string `json:"version"`
		AuthRequired bool   `json:"authRequired"`
	}](t, body)
	if !got.OK || got.Version != "1" || !got.AuthRequired {
		t.Fatalf("health = %+v", got)
	}
}

func TestAuthFlow(t *testing.T) {
	env := newEnv(t, 5<<30)
	c := env.client

	code, body, headers := env.do(t, c, http.MethodPost, "/api/auth/register", map[string]any{
		"email": "Alice@Example.com", "password": testPassword, "name": "Alice",
	})
	requireCode(t, code, http.StatusCreated, body)
	registered := decode[struct {
		User User `json:"user"`
	}](t, body).User
	if registered.Email != "alice@example.com" || registered.Name != "Alice" || registered.Plan != planFree ||
		registered.ID == "" || !registered.HasPassword || registered.GoogleLinked {
		t.Fatalf("registered user = %+v", registered)
	}
	setCookie := strings.Join(headers.Values("Set-Cookie"), "\n")
	for _, want := range []string{cookieName + "=", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=2592000"} {
		if !strings.Contains(setCookie, want) {
			t.Errorf("Set-Cookie missing %q: %s", want, setCookie)
		}
	}

	user, usage := env.me(t, c)
	if user.ID != registered.ID || usage.UsedBytes != 0 || usage.FileCount != 0 {
		t.Fatalf("me = %+v %+v", user, usage)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/auth/logout", nil)
	requireCode(t, code, http.StatusOK, body)
	code, body, _ = env.do(t, c, http.MethodGet, "/api/auth/me", nil)
	requireCode(t, code, http.StatusUnauthorized, body)
	if got := decode[struct {
		Error string `json:"error"`
	}](t, body).Error; got != "unauthenticated" {
		t.Fatalf("401 error = %q", got)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/auth/login", map[string]any{
		"email": "alice@example.com", "password": "wrong password",
	})
	requireCode(t, code, http.StatusUnauthorized, body)

	user = env.login(t, c, "ALICE@example.com")
	if user.ID != registered.ID {
		t.Fatalf("login user = %+v", user)
	}

	other := env.anon()
	code, body, _ = env.do(t, other, http.MethodPost, "/api/auth/register", map[string]any{
		"email": "ALICE@example.com", "password": testPassword, "name": "Other",
	})
	requireCode(t, code, http.StatusConflict, body)

	code, body, _ = env.do(t, other, http.MethodPost, "/api/auth/register", map[string]any{
		"email": "new@example.com", "password": "1234567", "name": "Weak",
	})
	requireCode(t, code, http.StatusBadRequest, body)

	for _, req := range []map[string]any{
		{"email": "bad-email", "password": testPassword, "name": "Name"},
		{"email": "ok@example.com", "password": testPassword, "name": ""},
		{"email": "ok@example.com", "password": testPassword, "name": strings.Repeat("n", 81)},
	} {
		code, body, _ = env.do(t, other, http.MethodPost, "/api/auth/register", req)
		requireCode(t, code, http.StatusBadRequest, body)
	}
}

func TestProtectedRoutesRequireAuth(t *testing.T) {
	env := newEnv(t, 5<<30)
	c := env.anon()
	routes := []struct{ method, path string }{
		{http.MethodGet, "/api/files"},
		{http.MethodPost, "/api/files"},
		{http.MethodGet, "/api/files/abc"},
		{http.MethodPut, "/api/files/abc"},
		{http.MethodDelete, "/api/files/abc"},
		{http.MethodPost, "/api/files/abc/duplicate"},
		{http.MethodPost, "/api/files/abc/pin"},
		{http.MethodGet, "/api/files/abc/thumb"},
		{http.MethodGet, "/api/assets"},
		{http.MethodPost, "/api/assets"},
		{http.MethodGet, "/api/assets/abc"},
		{http.MethodDelete, "/api/assets/abc"},
		{http.MethodGet, "/api/settings"},
		{http.MethodPut, "/api/settings"},
		{http.MethodGet, "/api/account/usage"},
		{http.MethodPost, "/api/account/plan"},
		{http.MethodDelete, "/api/account"},
		{http.MethodPost, "/api/import/figma"},
		{http.MethodPost, "/api/import/url"},
		{http.MethodGet, "/api/import/config"},
	}
	for _, rt := range routes {
		code, body, _ := env.do(t, c, rt.method, rt.path, nil)
		if code != http.StatusUnauthorized {
			t.Errorf("%s %s = %d, want 401; body: %s", rt.method, rt.path, code, body)
			continue
		}
		if errText := decode[struct {
			Error string `json:"error"`
		}](t, body).Error; errText != "unauthenticated" {
			t.Errorf("%s %s error = %q", rt.method, rt.path, errText)
		}
	}
}

func TestSessionPersistence(t *testing.T) {
	env := newEnv(t, 5<<30)
	c := env.client
	user := env.signup(t, c, "persist@example.com")

	u, _ := url.Parse(env.srv.URL)
	cookies := env.jar.Cookies(u)
	if len(cookies) == 0 {
		t.Fatal("no session cookie captured")
	}

	restarted := startEnv(t, env.root, env.quota)
	jar, _ := cookiejar.New(nil)
	jar.SetCookies(u, cookies)
	client := &http.Client{Jar: jar}
	got, _ := restarted.me(t, client)
	if got.ID != user.ID {
		t.Fatalf("session did not survive restart: %+v", got)
	}
}

func TestFilesAndClientIDs(t *testing.T) {
	env := newEnv(t, 5<<30)
	c := env.client
	env.signup(t, c, "files@example.com")
	thumb := pngDataURL(tinyPNG(t))
	doc := map[string]any{"version": "2.21", "children": []any{}}

	code, body, _ := env.do(t, c, http.MethodPost, "/api/files", map[string]any{
		"id": "clientFile01", "name": "Sketch", "doc": doc, "thumbnail": thumb, "draft": true,
	})
	requireCode(t, code, http.StatusCreated, body)
	meta := decode[FileMeta](t, body)
	if meta.ID != "clientFile01" || !meta.HasThumb || !meta.Draft {
		t.Fatalf("create = %+v", meta)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/files", map[string]any{"id": "clientFile01", "doc": doc})
	requireCode(t, code, http.StatusConflict, body)
	for _, id := range []string{"bad id", "a/b", "../x"} {
		code, body, _ = env.do(t, c, http.MethodPost, "/api/files", map[string]any{"id": id})
		requireCode(t, code, http.StatusBadRequest, body)
	}

	code, body, _ = env.do(t, c, http.MethodGet, "/api/files", nil)
	requireCode(t, code, http.StatusOK, body)
	list := decode[struct {
		Files []FileMeta `json:"files"`
	}](t, body)
	if len(list.Files) != 1 || list.Files[0].ID != meta.ID {
		t.Fatalf("list = %+v", list)
	}

	code, body, _ = env.do(t, c, http.MethodGet, "/api/files/clientFile01", nil)
	requireCode(t, code, http.StatusOK, body)
	got := decode[struct {
		FileMeta
		Doc map[string]any `json:"doc"`
	}](t, body)
	if got.Doc["version"] != "2.21" {
		t.Fatalf("get = %+v", got)
	}

	code, body, _ = env.do(t, c, http.MethodPut, "/api/files/clientFile01", map[string]any{
		"name": "Renamed", "pinned": true, "draft": false,
	})
	requireCode(t, code, http.StatusOK, body)
	updated := decode[FileMeta](t, body)
	if updated.Name != "Renamed" || !updated.Pinned || updated.Draft {
		t.Fatalf("update = %+v", updated)
	}

	code, body, _ = env.do(t, c, http.MethodPut, "/api/files/offline01", map[string]any{"name": "Offline", "doc": doc})
	requireCode(t, code, http.StatusOK, body)
	if got := decode[FileMeta](t, body); got.ID != "offline01" || got.Name != "Offline" {
		t.Fatalf("upsert = %+v", got)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/files/clientFile01/duplicate", nil)
	requireCode(t, code, http.StatusOK, body)
	dup := decode[struct {
		File FileMeta `json:"file"`
	}](t, body).File
	if dup.ID == meta.ID || dup.Name != "Renamed copy" {
		t.Fatalf("duplicate = %+v", dup)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/files/clientFile01/pin", map[string]any{"pinned": false})
	requireCode(t, code, http.StatusOK, body)
	if pinned := decode[FileMeta](t, body); pinned.Pinned {
		t.Fatal("pin false did not stick")
	}

	code, body, _ = env.do(t, c, http.MethodGet, "/api/files/clientFile01/thumb", nil)
	requireCode(t, code, http.StatusOK, body)
	if !bytes.Equal(body, tinyPNG(t)) {
		t.Error("thumbnail bytes differ")
	}

	code, body, _ = env.do(t, c, http.MethodDelete, "/api/files/"+dup.ID, nil)
	requireCode(t, code, http.StatusOK, body)
	code, body, _ = env.do(t, c, http.MethodDelete, "/api/files/clientFile01", nil)
	requireCode(t, code, http.StatusOK, body)
	code, body, _ = env.do(t, c, http.MethodGet, "/api/files/clientFile01", nil)
	requireCode(t, code, http.StatusNotFound, body)
}

func TestThumbnailInvalid(t *testing.T) {
	env := newEnv(t, 5<<30)
	c := env.client
	env.signup(t, c, "thumb@example.com")
	meta := env.createFile(t, c, map[string]any{"name": "Bad thumb", "thumbnail": "data:image/png;base64,bm90IGEgcG5n"})
	code, body, _ := env.do(t, c, http.MethodGet, "/api/files/"+meta.ID+"/thumb", nil)
	requireCode(t, code, http.StatusNotFound, body)
}

func TestAssetsAPI(t *testing.T) {
	env := newEnv(t, 5<<30)
	c := env.client
	env.signup(t, c, "assets@example.com")
	pngBytes := tinyPNG(t)

	code, body, _ := env.upload(t, c, "dot.png", pngBytes)
	requireCode(t, code, http.StatusCreated, body)
	meta := decode[AssetMeta](t, body)
	if meta.Name != "dot.png" || meta.Type != "image/png" || meta.URL != "/api/assets/"+meta.ID {
		t.Fatalf("asset = %+v", meta)
	}

	code, body, _ = env.do(t, c, http.MethodGet, "/api/assets", nil)
	requireCode(t, code, http.StatusOK, body)
	list := decode[struct {
		Assets []AssetMeta `json:"assets"`
	}](t, body)
	if len(list.Assets) != 1 || list.Assets[0].ID != meta.ID {
		t.Fatalf("asset list = %+v", list)
	}

	code, body, headers := env.do(t, c, http.MethodGet, meta.URL, nil)
	requireCode(t, code, http.StatusOK, body)
	if headers.Get("Content-Type") != "image/png" || !bytes.Equal(body, pngBytes) {
		t.Fatal("asset payload mismatch")
	}

	code, body, _ = env.upload(t, c, "bad.txt", []byte("not an image"))
	requireCode(t, code, http.StatusBadRequest, body)

	code, body, _ = env.upload(t, c, "icon.svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`))
	requireCode(t, code, http.StatusCreated, body)
	svg := decode[AssetMeta](t, body)
	code, body, headers = env.do(t, c, http.MethodGet, svg.URL, nil)
	requireCode(t, code, http.StatusOK, body)
	if headers.Get("Content-Security-Policy") != "sandbox" || headers.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("SVG hardening headers missing")
	}

	code, body, _ = env.do(t, c, http.MethodDelete, meta.URL, nil)
	requireCode(t, code, http.StatusOK, body)
	code, body, _ = env.do(t, c, http.MethodGet, meta.URL, nil)
	requireCode(t, code, http.StatusNotFound, body)
}

func TestSettingsAPI(t *testing.T) {
	env := newEnv(t, 5<<30)
	c := env.client
	env.signup(t, c, "settings@example.com")

	code, body, _ := env.do(t, c, http.MethodGet, "/api/settings", nil)
	requireCode(t, code, http.StatusOK, body)
	initial := decode[struct {
		Settings json.RawMessage `json:"settings"`
	}](t, body)
	if string(initial.Settings) != "null" {
		t.Fatalf("initial settings = %s", initial.Settings)
	}

	bodyIn := map[string]any{"theme": "light", "accent": "#3d99ff", "gridSize": 8}
	code, body, _ = env.do(t, c, http.MethodPut, "/api/settings", bodyIn)
	requireCode(t, code, http.StatusOK, body)
	code, body, _ = env.do(t, c, http.MethodGet, "/api/settings", nil)
	requireCode(t, code, http.StatusOK, body)
	got := decode[struct {
		Settings map[string]any `json:"settings"`
	}](t, body)
	if got.Settings["theme"] != "light" || got.Settings["gridSize"] != float64(8) {
		t.Fatalf("settings = %+v", got.Settings)
	}

	code, body, _ = env.do(t, c, http.MethodPut, "/api/settings", []any{1, 2})
	requireCode(t, code, http.StatusBadRequest, body)
}

func TestUserIsolation(t *testing.T) {
	env := newEnv(t, 5<<30)
	alice := env.newClient()
	bob := env.newClient()
	env.signup(t, alice, "alice2@example.com")
	env.signup(t, bob, "bob2@example.com")

	pngBytes := tinyPNG(t)
	meta := env.createFile(t, alice, map[string]any{
		"id": "shared01", "name": "Alice doc", "doc": map[string]any{"owner": "alice"},
		"thumbnail": pngDataURL(pngBytes),
	})
	code, body, _ := env.upload(t, alice, "alice.png", pngBytes)
	requireCode(t, code, http.StatusCreated, body)
	asset := decode[AssetMeta](t, body)

	for _, rt := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/api/files/shared01", nil},
		{http.MethodDelete, "/api/files/shared01", nil},
		{http.MethodPost, "/api/files/shared01/duplicate", nil},
		{http.MethodPost, "/api/files/shared01/pin", map[string]any{"pinned": true}},
		{http.MethodGet, "/api/files/shared01/thumb", nil},
		{http.MethodGet, asset.URL, nil},
		{http.MethodDelete, asset.URL, nil},
	} {
		code, body, _ = env.do(t, bob, rt.method, rt.path, rt.body)
		requireCode(t, code, http.StatusNotFound, body)
	}

	code, body, _ = env.do(t, bob, http.MethodGet, "/api/files", nil)
	requireCode(t, code, http.StatusOK, body)
	if list := decode[struct {
		Files []FileMeta `json:"files"`
	}](t, body); len(list.Files) != 0 {
		t.Fatalf("bob sees alice files: %+v", list.Files)
	}

	code, body, _ = env.do(t, bob, http.MethodPut, "/api/files/shared01", map[string]any{
		"name": "Bob doc", "doc": map[string]any{"owner": "bob"},
	})
	requireCode(t, code, http.StatusOK, body)

	code, body, _ = env.do(t, alice, http.MethodGet, "/api/files/"+meta.ID, nil)
	requireCode(t, code, http.StatusOK, body)
	aliceDoc := decode[struct {
		Doc map[string]any `json:"doc"`
	}](t, body)
	if aliceDoc.Doc["owner"] != "alice" {
		t.Fatalf("alice doc overwritten: %+v", aliceDoc.Doc)
	}
	code, body, _ = env.do(t, bob, http.MethodGet, "/api/files/shared01", nil)
	requireCode(t, code, http.StatusOK, body)
	bobDoc := decode[struct {
		Doc map[string]any `json:"doc"`
	}](t, body)
	if bobDoc.Doc["owner"] != "bob" {
		t.Fatalf("bob doc = %+v", bobDoc.Doc)
	}
}

func TestQuotaExceededAndDeleteFrees(t *testing.T) {
	env := newEnv(t, 500)
	c := env.client
	env.signup(t, c, "quota@example.com")

	usage := env.usage(t, c)
	if usage.LimitBytes != 500 || usage.UsedBytes != 0 {
		t.Fatalf("initial usage = %+v", usage)
	}

	code, body, _ := env.do(t, c, http.MethodPost, "/api/files", map[string]any{
		"name": "Too big", "doc": map[string]any{"blob": strings.Repeat("x", 2000)},
	})
	requireCode(t, code, http.StatusPaymentRequired, body)
	quota := decode[struct {
		Error      string `json:"error"`
		Usage      Usage  `json:"usage"`
		LimitBytes int64  `json:"limitBytes"`
		Plan       string `json:"plan"`
	}](t, body)
	if quota.Error != "quota_exceeded" || quota.LimitBytes != 500 || quota.Plan != planFree ||
		quota.Usage.LimitBytes != 500 || quota.Usage.UsedBytes != 0 {
		t.Fatalf("quota response = %+v", quota)
	}

	var firstID string
	var failingPayload map[string]any
	for i := 0; i < 30; i++ {
		payload := map[string]any{"name": fmt.Sprintf("f%d", i), "doc": map[string]any{"n": i}}
		code, body, _ = env.do(t, c, http.MethodPost, "/api/files", payload)
		if code == http.StatusCreated {
			meta := decode[FileMeta](t, body)
			if firstID == "" {
				firstID = meta.ID
			}
			continue
		}
		if code == http.StatusPaymentRequired {
			failingPayload = payload
			break
		}
		t.Fatalf("create %d: status %d body %s", i, code, body)
	}
	if failingPayload == nil {
		t.Fatal("tiny quota never rejected a create")
	}

	code, body, _ = env.do(t, c, http.MethodGet, "/api/files/"+firstID, nil)
	requireCode(t, code, http.StatusOK, body)
	before := decode[struct {
		FileMeta
		Doc map[string]any `json:"doc"`
	}](t, body)

	code, body, _ = env.do(t, c, http.MethodPut, "/api/files/"+firstID, map[string]any{
		"doc": map[string]any{"blob": strings.Repeat("y", 2000)},
	})
	requireCode(t, code, http.StatusPaymentRequired, body)

	code, body, _ = env.do(t, c, http.MethodGet, "/api/files/"+firstID, nil)
	requireCode(t, code, http.StatusOK, body)
	after := decode[struct {
		FileMeta
		Doc map[string]any `json:"doc"`
	}](t, body)
	if after.Name != before.Name || fmt.Sprint(after.Doc) != fmt.Sprint(before.Doc) {
		t.Fatalf("failed update changed file: before=%+v after=%+v", before, after)
	}

	code, body, _ = env.upload(t, c, "big.png", append(tinyPNG(t), bytes.Repeat([]byte{0}, 2000)...))
	requireCode(t, code, http.StatusPaymentRequired, body)
	code, body, _ = env.do(t, c, http.MethodGet, "/api/assets", nil)
	requireCode(t, code, http.StatusOK, body)
	if list := decode[struct {
		Assets []AssetMeta `json:"assets"`
	}](t, body); len(list.Assets) != 0 {
		t.Fatalf("quota-failed upload left assets: %+v", list.Assets)
	}

	usedBefore := env.usage(t, c).UsedBytes
	code, body, _ = env.do(t, c, http.MethodDelete, "/api/files/"+firstID, nil)
	requireCode(t, code, http.StatusOK, body)
	usedAfter := env.usage(t, c).UsedBytes
	if usedAfter >= usedBefore {
		t.Fatalf("delete did not free quota: %d -> %d", usedBefore, usedAfter)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/files", failingPayload)
	requireCode(t, code, http.StatusCreated, body)
}

func TestProPlanUnlimitedAndPersistence(t *testing.T) {
	env := newEnv(t, 500)
	c := env.client
	user := env.signup(t, c, "pro@example.com")

	code, body, _ := env.do(t, c, http.MethodPost, "/api/account/plan", map[string]any{"plan": planPro})
	requireCode(t, code, http.StatusOK, body)
	plan := decode[struct {
		User  User  `json:"user"`
		Usage Usage `json:"usage"`
	}](t, body)
	if plan.User.Plan != planPro || plan.Usage.LimitBytes != 0 || plan.Usage.Percent != 0 {
		t.Fatalf("plan switch = %+v", plan)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/files", map[string]any{
		"name": "Huge", "doc": map[string]any{"blob": strings.Repeat("z", 5000)},
	})
	requireCode(t, code, http.StatusCreated, body)

	code, body, _ = env.do(t, c, http.MethodPost, "/api/account/plan", map[string]any{"plan": "enterprise"})
	requireCode(t, code, http.StatusBadRequest, body)

	u, _ := url.Parse(env.srv.URL)
	cookies := env.jar.Cookies(u)
	restarted := startEnv(t, env.root, env.quota)
	jar, _ := cookiejar.New(nil)
	jar.SetCookies(u, cookies)
	client := &http.Client{Jar: jar}
	gotUser, gotUsage := restarted.me(t, client)
	if gotUser.ID != user.ID || gotUser.Plan != planPro || gotUsage.LimitBytes != 0 {
		t.Fatalf("plan did not persist: %+v %+v", gotUser, gotUsage)
	}

	code, body, _ = restarted.do(t, client, http.MethodPost, "/api/account/plan", map[string]any{"plan": planFree})
	requireCode(t, code, http.StatusOK, body)
	downgraded := decode[struct {
		Usage Usage `json:"usage"`
	}](t, body)
	if downgraded.Usage.LimitBytes != 500 {
		t.Fatalf("downgrade usage = %+v", downgraded.Usage)
	}
}

func TestAccountDelete(t *testing.T) {
	env := newEnv(t, 5<<30)
	c := env.client
	user := env.signup(t, c, "delete@example.com")
	env.createFile(t, c, map[string]any{"name": "Doomed"})
	env.upload(t, c, "dot.png", tinyPNG(t))
	code, body, _ := env.do(t, c, http.MethodPut, "/api/settings", map[string]any{"theme": "light"})
	requireCode(t, code, http.StatusOK, body)

	code, body, _ = env.do(t, c, http.MethodDelete, "/api/account", map[string]any{"confirm": false})
	requireCode(t, code, http.StatusBadRequest, body)
	code, body, _ = env.do(t, c, http.MethodDelete, "/api/account", map[string]any{"confirm": true})
	requireCode(t, code, http.StatusOK, body)

	code, body, _ = env.do(t, c, http.MethodGet, "/api/auth/me", nil)
	requireCode(t, code, http.StatusUnauthorized, body)
	if _, err := os.Stat(filepath.Join(env.root, "users", user.ID)); !os.IsNotExist(err) {
		t.Fatalf("user directory still exists: %v", err)
	}
	code, body, _ = env.do(t, env.anon(), http.MethodPost, "/api/auth/login", map[string]any{
		"email": "delete@example.com", "password": testPassword,
	})
	requireCode(t, code, http.StatusUnauthorized, body)
	code, body, _ = env.do(t, env.anon(), http.MethodGet, "/api/health", nil)
	requireCode(t, code, http.StatusOK, body)
	counts := decode[struct {
		Files  int `json:"files"`
		Assets int `json:"assets"`
	}](t, body)
	if counts.Files != 0 || counts.Assets != 0 {
		t.Fatalf("health counts after delete = %+v", counts)
	}
}

func TestLegacyMigration(t *testing.T) {
	root := t.TempDir()
	pngBytes := tinyPNG(t)
	legacyFile, err := json.Marshal(&File{
		FileMeta: FileMeta{ID: "legacyfile01", Name: "Legacy", CreatedAt: 1, UpdatedAt: 1, HasThumb: false},
		Doc:      json.RawMessage(`{"version":"2.21"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "files"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "files", "legacyfile01.json"), legacyFile, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "assets", "legacyasset1-pic.png"), pngBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	index, _ := json.Marshal([]AssetMeta{{
		ID: "legacyasset1", Name: "pic.png", Type: "image/png",
		URL: "/api/assets/legacyasset1", Size: int64(len(pngBytes)), CreatedAt: 1,
	}})
	if err := os.WriteFile(filepath.Join(root, "assets", "index.json"), index, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "settings.json"), []byte(`{"theme":"light"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	env := startEnv(t, root, 5<<30)
	c := env.client
	env.signup(t, c, "first@example.com")

	code, body, _ := env.do(t, c, http.MethodGet, "/api/files", nil)
	requireCode(t, code, http.StatusOK, body)
	files := decode[struct {
		Files []FileMeta `json:"files"`
	}](t, body)
	if len(files.Files) != 1 || files.Files[0].ID != "legacyfile01" {
		t.Fatalf("migrated files = %+v", files.Files)
	}

	code, body, _ = env.do(t, c, http.MethodGet, "/api/assets/legacyasset1", nil)
	requireCode(t, code, http.StatusOK, body)
	if !bytes.Equal(body, pngBytes) {
		t.Fatal("migrated asset bytes differ")
	}

	code, body, _ = env.do(t, c, http.MethodGet, "/api/settings", nil)
	requireCode(t, code, http.StatusOK, body)
	settings := decode[struct {
		Settings map[string]any `json:"settings"`
	}](t, body)
	if settings.Settings["theme"] != "light" {
		t.Fatalf("migrated settings = %+v", settings.Settings)
	}

	if _, err := os.Stat(filepath.Join(root, "files")); !os.IsNotExist(err) {
		t.Fatalf("legacy files dir still present: %v", err)
	}

	second := env.newClient()
	env.signup(t, second, "second@example.com")
	code, body, _ = env.do(t, second, http.MethodGet, "/api/files", nil)
	requireCode(t, code, http.StatusOK, body)
	if list := decode[struct {
		Files []FileMeta `json:"files"`
	}](t, body); len(list.Files) != 0 {
		t.Fatalf("second user inherited legacy files: %+v", list.Files)
	}
}

func TestRateLimit(t *testing.T) {
	env := newEnv(t, 5<<30)
	env.signup(t, env.client, "limit@example.com")
	c := env.anon()
	for i := 0; i < loginMax; i++ {
		code, body, _ := env.do(t, c, http.MethodPost, "/api/auth/login", map[string]any{
			"email": "limit@example.com", "password": "wrong password",
		})
		requireCode(t, code, http.StatusUnauthorized, body)
	}
	code, body, _ := env.do(t, c, http.MethodPost, "/api/auth/login", map[string]any{
		"email": "limit@example.com", "password": testPassword,
	})
	requireCode(t, code, http.StatusTooManyRequests, body)
}

func TestPathTraversalRejected(t *testing.T) {
	env := newEnv(t, 5<<30)
	c := env.client
	env.signup(t, c, "traversal@example.com")
	targets := []string{
		"/api/files/..%2f..%2fetc%2fpasswd",
		"/api/files/%2e%2e",
		"/api/files/..%2F..%2Fsettings",
		"/api/assets/..%2f..%2findex.json",
	}
	for _, target := range targets {
		code, body, headers := env.do(t, c, http.MethodGet, target, nil)
		requireCode(t, code, http.StatusBadRequest, body)
		if ct := headers.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Errorf("%s Content-Type = %q", target, ct)
		}
	}
}

func TestOversizedBody(t *testing.T) {
	env := newEnv(t, 5<<30)
	c := env.client
	env.signup(t, c, "oversize@example.com")
	body := []byte(`{"name":"big","doc":{"blob":"` + strings.Repeat("x", 13<<20) + `"}}`)
	code, resp, _ := env.doRaw(t, c, http.MethodPost, "/api/files", "application/json", body)
	requireCode(t, code, http.StatusRequestEntityTooLarge, resp)

	code, resp, _ = env.do(t, c, http.MethodPost, "/api/files", map[string]any{"name": strings.Repeat("a", maxName+1)})
	requireCode(t, code, http.StatusBadRequest, resp)
}

func TestSPAAndAPINotFound(t *testing.T) {
	env := newEnv(t, 5<<30)
	code, body, headers := env.do(t, env.anon(), http.MethodGet, "/editor/deep/route", nil)
	requireCode(t, code, http.StatusOK, body)
	if !strings.Contains(string(body), "<!doctype html>") || !strings.HasPrefix(headers.Get("Content-Type"), "text/html") {
		t.Fatalf("SPA fallback = %q %q", headers.Get("Content-Type"), body)
	}

	code, body, _ = env.do(t, env.anon(), http.MethodGet, "/assets/app.js", nil)
	requireCode(t, code, http.StatusOK, body)
	if string(body) != "console.log('pen')" {
		t.Fatalf("static body = %q", body)
	}

	c := env.client
	env.signup(t, c, "spa@example.com")
	code, body, headers = env.do(t, c, http.MethodGet, "/api/does-not-exist", nil)
	requireCode(t, code, http.StatusNotFound, body)
	if !strings.HasPrefix(headers.Get("Content-Type"), "application/json") {
		t.Errorf("API 404 Content-Type = %q", headers.Get("Content-Type"))
	}
	code, body, _ = env.do(t, c, http.MethodPost, "/not-api", nil)
	requireCode(t, code, http.StatusMethodNotAllowed, body)
}

func TestCORS(t *testing.T) {
	env := newEnv(t, 5<<30)
	for _, origin := range []string{"http://localhost:5173", "http://127.0.0.1:5173"} {
		req, _ := http.NewRequest(http.MethodOptions, env.srv.URL+"/api/files", nil)
		req.Header.Set("Origin", origin)
		req.Header.Set("Access-Control-Request-Method", "POST")
		req.Header.Set("Access-Control-Request-Headers", "Content-Type")
		code, _, headers := env.doReq(t, env.anon(), req)
		requireCode(t, code, http.StatusNoContent, nil)
		if headers.Get("Access-Control-Allow-Origin") != origin ||
			headers.Get("Access-Control-Allow-Credentials") != "true" {
			t.Fatalf("CORS headers = %+v", headers)
		}
	}

	req, _ := http.NewRequest(http.MethodOptions, env.srv.URL+"/api/files", nil)
	req.Header.Set("Origin", "http://evil.example")
	code, _, headers := env.doReq(t, env.anon(), req)
	requireCode(t, code, http.StatusNoContent, nil)
	if headers.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("unexpected ACAO: %q", headers.Get("Access-Control-Allow-Origin"))
	}
}

func TestConcurrentMutations(t *testing.T) {
	env := newEnv(t, 5<<30)
	c := env.client
	env.signup(t, c, "concurrent@example.com")
	base := env.createFile(t, c, map[string]any{"name": "Base"})

	var wg sync.WaitGroup
	errs := make(chan string, 64)
	for i := 0; i < 8; i++ {
		i := i
		wg.Add(3)
		go func() {
			defer wg.Done()
			code, body, _ := env.do(t, c, http.MethodPut, "/api/files/"+base.ID, map[string]any{"name": fmt.Sprintf("n%d", i)})
			if code != http.StatusOK {
				errs <- fmt.Sprintf("update %d: %d %s", i, code, body)
			}
		}()
		go func() {
			defer wg.Done()
			code, body, _ := env.do(t, c, http.MethodPost, "/api/files/"+base.ID+"/pin", map[string]any{"pinned": i%2 == 0})
			if code != http.StatusOK {
				errs <- fmt.Sprintf("pin %d: %d %s", i, code, body)
			}
		}()
		go func() {
			defer wg.Done()
			code, body, _ := env.do(t, c, http.MethodPost, "/api/files/"+base.ID+"/duplicate", nil)
			if code != http.StatusOK {
				errs <- fmt.Sprintf("duplicate %d: %d %s", i, code, body)
			}
		}()
	}
	wg.Wait()
	close(errs)
	for msg := range errs {
		t.Error(msg)
	}

	code, body, _ := env.do(t, c, http.MethodGet, "/api/files", nil)
	requireCode(t, code, http.StatusOK, body)
	if list := decode[struct {
		Files []FileMeta `json:"files"`
	}](t, body); len(list.Files) != 9 {
		t.Fatalf("files after concurrency = %d, want 9", len(list.Files))
	}
}

// ---- Google OAuth tests ----

type fakeGoogleExchanger struct {
	identity GoogleIdentity
	err      error
	calls    int
	code     string
	redirect string
}

func (f *fakeGoogleExchanger) Exchange(_ context.Context, code, redirectURI string) (GoogleIdentity, error) {
	f.calls++
	f.code = code
	f.redirect = redirectURI
	return f.identity, f.err
}

func googleEnv(t *testing.T, fake *fakeGoogleExchanger, publicURL string) *testEnv {
	t.Helper()
	return startEnv(t, t.TempDir(), 5<<30,
		NewGoogleOAuth("fake-client-id", "fake-client-secret", publicURL, fake))
}

func (e *testEnv) noRedirectClient() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{
		Jar: jar,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func (e *testEnv) beginGoogle(t *testing.T, c *http.Client, redirect string) (state, location string) {
	t.Helper()
	code, body, headers := e.do(t, c, http.MethodGet,
		"/api/auth/google/start?redirect="+url.QueryEscape(redirect), nil)
	requireCode(t, code, http.StatusFound, body)
	location = headers.Get("Location")
	u, err := url.Parse(location)
	if err != nil {
		t.Fatalf("parse location: %v", err)
	}
	return u.Query().Get("state"), location
}

func (e *testEnv) finishGoogle(t *testing.T, c *http.Client, query string) string {
	t.Helper()
	code, body, headers := e.do(t, c, http.MethodGet, "/api/auth/google/callback?"+query, nil)
	requireCode(t, code, http.StatusFound, body)
	return headers.Get("Location")
}

func TestGoogleConfig(t *testing.T) {
	disabled := newEnv(t, 5<<30)
	code, body, _ := disabled.do(t, disabled.anon(), http.MethodGet, "/api/auth/config", nil)
	requireCode(t, code, http.StatusOK, body)
	got := decode[struct {
		GoogleEnabled bool   `json:"googleEnabled"`
		AuthRequired  bool   `json:"authRequired"`
		Version       string `json:"version"`
	}](t, body)
	if got.GoogleEnabled || !got.AuthRequired || got.Version != "1" {
		t.Fatalf("disabled config = %+v", got)
	}

	enabled := googleEnv(t, &fakeGoogleExchanger{}, "https://pen.example.test")
	code, body, _ = enabled.do(t, enabled.anon(), http.MethodGet, "/api/auth/config", nil)
	requireCode(t, code, http.StatusOK, body)
	if got := decode[struct {
		GoogleEnabled bool `json:"googleEnabled"`
	}](t, body); !got.GoogleEnabled {
		t.Fatal("enabled config reported disabled")
	}
}

func TestGoogleStartUnconfigured(t *testing.T) {
	env := newEnv(t, 5<<30)
	code, body, headers := env.do(t, env.anon(), http.MethodGet, "/api/auth/google/start", nil)
	requireCode(t, code, http.StatusServiceUnavailable, body)
	if !strings.HasPrefix(headers.Get("Content-Type"), "application/json") {
		t.Errorf("Content-Type = %q", headers.Get("Content-Type"))
	}
	if got := decode[struct {
		Error string `json:"error"`
	}](t, body).Error; got != "google_not_configured" {
		t.Fatalf("error = %q", got)
	}
}

func TestGoogleStartConfigured(t *testing.T) {
	fake := &fakeGoogleExchanger{}
	env := googleEnv(t, fake, "https://pen.example.test/")
	client := env.noRedirectClient()

	code, body, headers := env.do(t, client, http.MethodGet,
		"/api/auth/google/start?redirect="+url.QueryEscape("/dashboard"), nil)
	requireCode(t, code, http.StatusFound, body)
	location := headers.Get("Location")
	u, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	if u.Scheme != "https" || u.Host != "accounts.google.com" || u.Path != "/o/oauth2/v2/auth" {
		t.Fatalf("auth URL = %s", location)
	}
	q := u.Query()
	state := q.Get("state")
	if state == "" {
		t.Fatal("missing state")
	}
	want := map[string]string{
		"client_id":     "fake-client-id",
		"redirect_uri":  "https://pen.example.test/api/auth/google/callback",
		"response_type": "code",
		"scope":         "openid email profile",
		"state":         state,
		"prompt":        "select_account",
	}
	for k, v := range want {
		if q.Get(k) != v {
			t.Errorf("%s = %q, want %q", k, q.Get(k), v)
		}
	}

	setCookie := strings.Join(headers.Values("Set-Cookie"), "\n")
	for _, want := range []string{oauthStateCookie + "=", "HttpOnly", "SameSite=Lax",
		"Path=/api/auth/google", "Max-Age=600"} {
		if !strings.Contains(setCookie, want) {
			t.Errorf("state Set-Cookie missing %q: %s", want, setCookie)
		}
	}
	cookies := client.Jar.Cookies(mustParseURL(t, env.srv.URL+"/api/auth/google/start"))
	if len(cookies) == 0 {
		t.Fatal("state cookie not stored")
	}
	var found bool
	for _, c := range cookies {
		if c.Name == oauthStateCookie {
			found = true
			if len(c.Value) != 43 {
				t.Errorf("state cookie length = %d", len(c.Value))
			}
		}
	}
	if !found {
		t.Fatal("state cookie missing")
	}
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestGoogleRedirectURILoopback(t *testing.T) {
	fake := &fakeGoogleExchanger{}
	env := googleEnv(t, fake, "")
	client := env.noRedirectClient()
	_, location := env.beginGoogle(t, client, "/")
	u, _ := url.Parse(location)
	if got, want := u.Query().Get("redirect_uri"), env.srv.URL+"/api/auth/google/callback"; got != want {
		t.Fatalf("redirect_uri = %q, want %q", got, want)
	}

	req := httptest.NewRequest(http.MethodGet, "http://evil.example/api/auth/google/start", nil)
	req.Host = "evil.example"
	rec := httptest.NewRecorder()
	env.api.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("non-loopback start = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
}

func TestGoogleCallbackInvalidState(t *testing.T) {
	fake := &fakeGoogleExchanger{}
	env := googleEnv(t, fake, "https://pen.example.test")

	noCookie := env.noRedirectClient()
	loc := env.finishGoogle(t, noCookie, "code=x&state=abc")
	if loc != "/?authError=invalid_state" {
		t.Fatalf("no-cookie location = %q", loc)
	}

	client := env.noRedirectClient()
	state, _ := env.beginGoogle(t, client, "/")
	loc = env.finishGoogle(t, client, "code=x&state="+url.QueryEscape(state+"x"))
	if loc != "/?authError=invalid_state" {
		t.Fatalf("mismatched state location = %q", loc)
	}
	if fake.calls != 0 {
		t.Fatal("exchanger called for invalid state")
	}
}

func TestGoogleCallbackNewUser(t *testing.T) {
	fake := &fakeGoogleExchanger{identity: GoogleIdentity{
		Sub: "google-sub-new", Email: "new.google@example.com", Name: "New Google", EmailVerified: true,
	}}
	env := googleEnv(t, fake, "https://pen.example.test")
	client := env.noRedirectClient()
	state, _ := env.beginGoogle(t, client, "/dashboard")
	loc := env.finishGoogle(t, client, "code=fake-code&state="+url.QueryEscape(state))
	if loc != "/dashboard" {
		t.Fatalf("callback location = %q", loc)
	}
	if fake.calls != 1 || fake.code != "fake-code" ||
		fake.redirect != "https://pen.example.test/api/auth/google/callback" {
		t.Fatalf("exchanger calls=%d code=%q redirect=%q", fake.calls, fake.code, fake.redirect)
	}

	user, usage := env.me(t, client)
	if user.Email != "new.google@example.com" || user.Plan != planFree ||
		user.HasPassword || !user.GoogleLinked {
		t.Fatalf("google user = %+v", user)
	}
	if usage.LimitBytes != 5<<30 || usage.FileCount != 0 {
		t.Fatalf("usage = %+v", usage)
	}
	meta := env.createFile(t, client, map[string]any{"name": "Google file"})
	if meta.ID == "" {
		t.Fatal("google user could not create a file")
	}

	code, body, _ := env.do(t, env.anon(), http.MethodPost, "/api/auth/login", map[string]any{
		"email": "new.google@example.com", "password": "anything at all",
	})
	requireCode(t, code, http.StatusUnauthorized, body)
	if got := decode[struct {
		Error string `json:"error"`
	}](t, body).Error; got != "invalid email or password" {
		t.Fatalf("password login error = %q", got)
	}
}

func TestGoogleCallbackLinksExistingEmail(t *testing.T) {
	fake := &fakeGoogleExchanger{identity: GoogleIdentity{
		Sub: "google-sub-link", Email: "link@example.com", Name: "Google Link", EmailVerified: true,
	}}
	env := googleEnv(t, fake, "https://pen.example.test")
	existing := env.client
	user := env.signup(t, existing, "link@example.com")
	code, body, _ := env.do(t, existing, http.MethodPost, "/api/account/plan", map[string]any{"plan": planPro})
	requireCode(t, code, http.StatusOK, body)
	code, body, _ = env.do(t, existing, http.MethodPost, "/api/auth/logout", nil)
	requireCode(t, code, http.StatusOK, body)

	client := env.noRedirectClient()
	state, _ := env.beginGoogle(t, client, "/")
	if loc := env.finishGoogle(t, client, "code=x&state="+url.QueryEscape(state)); loc != "/" {
		t.Fatalf("location = %q", loc)
	}
	gotUser, gotUsage := env.me(t, client)
	if gotUser.ID != user.ID || gotUser.Plan != planPro || !gotUser.HasPassword || !gotUser.GoogleLinked {
		t.Fatalf("linked user = %+v", gotUser)
	}
	if gotUsage.LimitBytes != 0 {
		t.Fatalf("linked pro usage = %+v", gotUsage)
	}
	if gotUser.Name != "Test User" {
		t.Fatalf("name changed on link: %q", gotUser.Name)
	}

	code, body, _ = env.do(t, env.anon(), http.MethodPost, "/api/auth/register", map[string]any{
		"email": "link@example.com", "password": testPassword, "name": "Duplicate",
	})
	requireCode(t, code, http.StatusConflict, body)

	passwordClient := env.anon()
	env.login(t, passwordClient, "link@example.com")
}

func TestGoogleCallbackUnverified(t *testing.T) {
	fake := &fakeGoogleExchanger{identity: GoogleIdentity{
		Sub: "google-unverified", Email: "unverified@example.com", Name: "Unverified", EmailVerified: false,
	}}
	env := googleEnv(t, fake, "https://pen.example.test")
	client := env.noRedirectClient()
	state, _ := env.beginGoogle(t, client, "/")
	if loc := env.finishGoogle(t, client, "code=x&state="+url.QueryEscape(state)); loc != "/?authError=email_unverified" {
		t.Fatalf("location = %q", loc)
	}
	code, body, _ := env.do(t, client, http.MethodGet, "/api/auth/me", nil)
	requireCode(t, code, http.StatusUnauthorized, body)

	code, body, _ = env.do(t, env.anon(), http.MethodPost, "/api/auth/register", map[string]any{
		"email": "unverified@example.com", "password": testPassword, "name": "Now Real",
	})
	requireCode(t, code, http.StatusCreated, body)
}

func TestGoogleRedirectSanitization(t *testing.T) {
	fake := &fakeGoogleExchanger{identity: GoogleIdentity{
		Sub: "google-redirect", Email: "redirect@example.com", Name: "Redirect", EmailVerified: true,
	}}
	env := googleEnv(t, fake, "https://pen.example.test")
	client := env.noRedirectClient()
	cases := []struct{ in, want string }{
		{"/dashboard", "/dashboard"},
		{"//evil.example/x", "/"},
		{"https://evil.example/x", "/"},
		{`/ok\evil`, "/"},
		{"/ok\r\nLocation: https://evil.example", "/"},
		{"javascript:alert(1)", "/"},
		{"", "/"},
		{"///evil.example", "/"},
	}
	for _, tc := range cases {
		state, _ := env.beginGoogle(t, client, tc.in)
		loc := env.finishGoogle(t, client, "code=x&state="+url.QueryEscape(state))
		if loc != tc.want {
			t.Errorf("redirect %q -> %q, want %q", tc.in, loc, tc.want)
		}
	}
}

func TestGoogleProviderFailures(t *testing.T) {
	fake := &fakeGoogleExchanger{identity: GoogleIdentity{
		Sub: "google-fail", Email: "fail@example.com", Name: "Fail", EmailVerified: true,
	}}
	env := googleEnv(t, fake, "https://pen.example.test")
	client := env.noRedirectClient()

	state, _ := env.beginGoogle(t, client, "/")
	loc := env.finishGoogle(t, client, "error=access_denied&state="+url.QueryEscape(state))
	if loc != "/?authError=access_denied" {
		t.Fatalf("access denied location = %q", loc)
	}
	if fake.calls != 0 {
		t.Fatal("exchanger called for denied consent")
	}

	fake.err = errors.New("network down")
	state, _ = env.beginGoogle(t, client, "/")
	loc = env.finishGoogle(t, client, "code=x&state="+url.QueryEscape(state))
	if loc != "/?authError=exchange_failed" {
		t.Fatalf("exchange failure location = %q", loc)
	}

	state, _ = env.beginGoogle(t, client, "/")
	loc = env.finishGoogle(t, client, "state="+url.QueryEscape(state))
	if loc != "/?authError=exchange_failed" {
		t.Fatalf("missing code location = %q", loc)
	}

	unconfigured := newEnv(t, 5<<30)
	loc = unconfigured.finishGoogle(t, unconfigured.noRedirectClient(), "code=x&state=y")
	if loc != "/?authError=google_unavailable" {
		t.Fatalf("unconfigured callback location = %q", loc)
	}
}

// ---- import proxy tests ----

func importEnv(t *testing.T, allowLocal bool) (*testEnv, *http.Client) {
	t.Helper()
	env := newEnv(t, 5<<30)
	env.api.imports = NewImportService(allowLocal)
	c := env.newClient()
	env.signup(t, c, "imports@example.com")
	return env, c
}

func TestFigmaImport(t *testing.T) {
	const token = "figma-secret-token-value"
	var capMu sync.Mutex
	var gotPath, gotQuery, gotToken string
	snapshot := func() (string, string, string) {
		capMu.Lock()
		defer capMu.Unlock()
		return gotPath, gotQuery, gotToken
	}
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capMu.Lock()
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		gotToken = r.Header.Get("X-Figma-Token")
		capMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/files/key123":
			_, _ = w.Write([]byte(`{"name":"Demo","document":{"id":"0:0","name":"Doc"}}`))
		case "/v1/files/key123/nodes":
			_, _ = w.Write([]byte(`{"nodes":{"1:2":{"document":{"id":"1:2"}}}}`))
		case "/v1/files/urlkey":
			_, _ = w.Write([]byte(`{"name":"ByUrl","document":{"id":"0:1"}}`))
		case "/v1/files/unauth":
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"err":"bad token"}`))
		case "/v1/files/slow":
			time.Sleep(300 * time.Millisecond)
			_, _ = w.Write([]byte(`{"document":{}}`))
		case "/v1/files/huge":
			w.Header().Set("Content-Length", fmt.Sprint(maxFigmaBytes+1))
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	defer fake.Close()

	env, c := importEnv(t, false)
	env.api.imports.figmaBase = fake.URL

	code, body, _ := env.do(t, c, http.MethodPost, "/api/import/figma", map[string]any{
		"fileKey": "key123", "token": token,
	})
	requireCode(t, code, http.StatusOK, body)
	doc := decode[struct {
		Document map[string]any `json:"document"`
	}](t, body)
	p, q, tok := snapshot()
	if doc.Document["name"] != "Demo" || p != "/v1/files/key123" ||
		q != "geometry=paths" || tok != token {
		t.Fatalf("figma request/response = %+v path=%q query=%q token=%q", doc.Document, p, q, tok)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/figma", map[string]any{
		"url": "https://www.figma.com/design/urlkey/My-File?node-id=1-2", "token": token,
	})
	requireCode(t, code, http.StatusOK, body)
	if p, _, _ := snapshot(); p != "/v1/files/urlkey" {
		t.Fatalf("url key path = %q", p)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/figma", map[string]any{
		"fileKey": "key123", "token": token, "nodeId": "1:2",
	})
	requireCode(t, code, http.StatusOK, body)
	nodes := decode[struct {
		Nodes map[string]any `json:"nodes"`
	}](t, body)
	p, q, _ = snapshot()
	if nodes.Nodes["1:2"] == nil || p != "/v1/files/key123/nodes" ||
		!strings.Contains(q, "ids=1%3A2") || !strings.Contains(q, "geometry=paths") {
		t.Fatalf("nodes = %+v path=%q query=%q", nodes.Nodes, p, q)
	}

	for _, bad := range []map[string]any{
		{"fileKey": "bad/key", "token": token},
		{"url": "https://evil.example/file/abc", "token": token},
		{"fileKey": "key123"},
		{"fileKey": "key123", "token": token, "nodeId": "../bad"},
	} {
		code, body, _ = env.do(t, c, http.MethodPost, "/api/import/figma", bad)
		requireCode(t, code, http.StatusBadRequest, body)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/figma", map[string]any{
		"fileKey": "unauth", "token": token,
	})
	requireCode(t, code, http.StatusUnauthorized, body)
	if got := decode[struct {
		Error string `json:"error"`
	}](t, body).Error; got != "figma_unauthorized" {
		t.Fatalf("unauthorized error = %q", got)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/figma", map[string]any{
		"fileKey": "huge", "token": token,
	})
	requireCode(t, code, http.StatusRequestEntityTooLarge, body)

	env.api.imports.figmaHTTP.Timeout = 40 * time.Millisecond
	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/figma", map[string]any{
		"fileKey": "slow", "token": token,
	})
	requireCode(t, code, http.StatusBadGateway, body)
	if got := decode[struct {
		Error string `json:"error"`
	}](t, body).Error; got != "figma_unavailable" {
		t.Fatalf("timeout error = %q", got)
	}

	// Token must never leak in the response or request logs.
	env.api.imports.limiter = newImportRateLimiter()
	env.api.imports.figmaHTTP.Timeout = 2 * time.Second
	var logs lockedBuffer
	oldLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/figma", map[string]any{
		"fileKey": "key123", "token": token,
	})
	slog.SetDefault(oldLogger)
	requireCode(t, code, http.StatusOK, body)
	if strings.Contains(string(body), token) || strings.Contains(logs.String(), token) {
		t.Fatal("figma token leaked")
	}
}

func TestImportURL(t *testing.T) {
	page := `<!doctype html><html><head>
<title>  Test &amp; Page </title>
<meta name="description" content="A &quot;quoted&quot; description">
<meta property="og:image" content="https://cdn.example.test/cover.png">
<meta name="theme-color" content="#112233">
</head><body><h1>Hello</h1></body></html>`

	mux := http.NewServeMux()
	mux.HandleFunc("/page", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, page)
	})
	mux.HandleFunc("/rel", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/page", http.StatusFound)
	})
	mux.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_, _ = io.WriteString(w, page)
	})
	mux.HandleFunc("/large", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(bytes.Repeat([]byte("a"), maxURLBytes+1))
	})
	mux.HandleFunc("/to-metadata", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data/", http.StatusFound)
	})
	for i := 0; i < 7; i++ {
		i := i
		mux.HandleFunc(fmt.Sprintf("/hop%d", i), func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, fmt.Sprintf("/hop%d", i+1), http.StatusFound)
		})
	}
	server := httptest.NewServer(mux)
	defer server.Close()

	env, c := importEnv(t, true)

	code, body, _ := env.do(t, c, http.MethodPost, "/api/import/url", map[string]any{
		"url": server.URL + "/page",
	})
	requireCode(t, code, http.StatusOK, body)
	got := decode[importURLResponse](t, body)
	if got.Status != 200 || got.Title != "Test & Page" || got.Description != `A "quoted" description` ||
		got.Image != "https://cdn.example.test/cover.png" || got.ThemeColor != "#112233" ||
		got.FinalURL != server.URL+"/page" || !strings.Contains(got.HTML, "<h1>Hello</h1>") {
		t.Fatalf("url import = %+v", got)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/url", map[string]any{
		"url": server.URL + "/rel",
	})
	requireCode(t, code, http.StatusOK, body)
	if got := decode[importURLResponse](t, body); got.FinalURL != server.URL+"/page" {
		t.Fatalf("relative redirect finalUrl = %q", got.FinalURL)
	}

	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/url", map[string]any{
		"url": server.URL + "/hop0",
	})
	requireCode(t, code, http.StatusBadGateway, body)

	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/url", map[string]any{
		"url": server.URL + "/to-metadata",
	})
	requireCode(t, code, http.StatusBadRequest, body)

	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/url", map[string]any{"url": "file:///etc/passwd"})
	requireCode(t, code, http.StatusBadRequest, body)
	if got := decode[struct {
		Error string `json:"error"`
	}](t, body).Error; got != "invalid_url" {
		t.Fatalf("scheme error = %q", got)
	}
	withCreds := strings.Replace(server.URL, "http://", "http://user:pass@", 1) + "/page"
	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/url", map[string]any{"url": withCreds})
	requireCode(t, code, http.StatusBadRequest, body)

	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/url", map[string]any{
		"url": server.URL + "/large",
	})
	requireCode(t, code, http.StatusRequestEntityTooLarge, body)

	env.api.imports.urlHTTP.Timeout = 30 * time.Millisecond
	code, body, _ = env.do(t, c, http.MethodPost, "/api/import/url", map[string]any{
		"url": server.URL + "/slow",
	})
	requireCode(t, code, http.StatusGatewayTimeout, body)
	if got := decode[struct {
		Error string `json:"error"`
	}](t, body).Error; got != "fetch_timeout" {
		t.Fatalf("timeout error = %q", got)
	}
}

func TestImportLocalImportsBlocked(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "<html><title>local</title></html>")
	}))
	defer server.Close()

	blocked, blockedClient := importEnv(t, false)
	code, body, _ := blocked.do(t, blockedClient, http.MethodPost, "/api/import/url", map[string]any{
		"url": server.URL,
	})
	requireCode(t, code, http.StatusBadRequest, body)
	if got := decode[struct {
		Error string `json:"error"`
	}](t, body).Error; got != "local_import_disabled" {
		t.Fatalf("blocked error = %q", got)
	}

	allowed, allowedClient := importEnv(t, true)
	code, body, _ = allowed.do(t, allowedClient, http.MethodPost, "/api/import/url", map[string]any{
		"url": server.URL,
	})
	requireCode(t, code, http.StatusOK, body)

	for _, tc := range []struct {
		env    *testEnv
		client *http.Client
	}{{blocked, blockedClient}, {allowed, allowedClient}} {
		code, body, _ = tc.env.do(t, tc.client, http.MethodGet, "/api/import/config", nil)
		requireCode(t, code, http.StatusOK, body)
		got := decode[struct {
			AllowLocalImports bool `json:"allowLocalImports"`
		}](t, body)
		if got.AllowLocalImports != tc.env.api.imports.allowLocal {
			t.Fatalf("config allowLocal = %v, want %v", got.AllowLocalImports, tc.env.api.imports.allowLocal)
		}
	}
}

func TestImportRateLimit(t *testing.T) {
	env, c := importEnv(t, true)
	for i := 0; i < importMaxTries; i++ {
		code, body, _ := env.do(t, c, http.MethodPost, "/api/import/url", map[string]any{"url": "file:///nope"})
		requireCode(t, code, http.StatusBadRequest, body)
	}
	code, body, _ := env.do(t, c, http.MethodPost, "/api/import/url", map[string]any{"url": "file:///nope"})
	requireCode(t, code, http.StatusTooManyRequests, body)
}

type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (w *lockedBuffer) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.b.Write(p)
}

func (w *lockedBuffer) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.b.String()
}
