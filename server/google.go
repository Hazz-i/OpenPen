package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	oauthStateCookie = "penclone_oauth_state"
	oauthStateTTL    = 10 * time.Minute
	googleAuthURL    = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL   = "https://oauth2.googleapis.com/token"
	googleUserInfo   = "https://openidconnect.googleapis.com/v1/userinfo"
)

// GoogleIdentity is the verified subset of Google userinfo we persist.
type GoogleIdentity struct {
	Sub           string
	Email         string
	Name          string
	EmailVerified bool
}

// GoogleExchanger isolates all outbound Google calls so tests can inject fakes.
type GoogleExchanger interface {
	Exchange(ctx context.Context, code, redirectURI string) (GoogleIdentity, error)
}

type oauthState struct {
	Redirect  string
	ExpiresAt int64
}

// GoogleOAuth owns optional Google OAuth configuration and state cookies.
type GoogleOAuth struct {
	ClientID     string
	ClientSecret string
	PublicURL    string
	Exchanger    GoogleExchanger

	mu     sync.Mutex
	states map[string]oauthState
}

func NewGoogleOAuth(clientID, clientSecret, publicURL string, exchanger GoogleExchanger) *GoogleOAuth {
	g := &GoogleOAuth{
		ClientID:     strings.TrimSpace(clientID),
		ClientSecret: strings.TrimSpace(clientSecret),
		PublicURL:    strings.TrimRight(strings.TrimSpace(publicURL), "/"),
		Exchanger:    exchanger,
		states:       map[string]oauthState{},
	}
	if g.Exchanger == nil && g.ClientID != "" && g.ClientSecret != "" {
		g.Exchanger = NewHTTPGoogleExchanger(g.ClientID, g.ClientSecret)
	}
	return g
}

func (g *GoogleOAuth) Configured() bool {
	return g != nil && g.ClientID != "" && g.ClientSecret != "" && g.Exchanger != nil
}

// RedirectURI uses the configured public URL, or derives a loopback URL from
// the request. Non-loopback hosts require an explicit public URL.
func (g *GoogleOAuth) RedirectURI(r *http.Request) (string, error) {
	if g == nil {
		return "", errGoogleNotConfigured
	}
	if g.PublicURL != "" {
		u, err := url.Parse(g.PublicURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
			u.RawQuery != "" || u.Fragment != "" {
			return "", errors.New("invalid public url")
		}
		return g.PublicURL + "/api/auth/google/callback", nil
	}
	host := r.Host
	if host == "" {
		return "", errors.New("missing host")
	}
	name := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		name = h
	} else {
		name = strings.Trim(host, "[]")
	}
	name = strings.Trim(name, "[]")
	if !isLoopbackName(name) {
		return "", errors.New("public url required for non-loopback hosts")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + host + "/api/auth/google/callback", nil
}

func isLoopbackName(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (g *GoogleOAuth) newState(redirect string) (string, error) {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	state := base64.RawURLEncoding.EncodeToString(buf[:])
	now := nowMillis()
	g.mu.Lock()
	for k, v := range g.states {
		if v.ExpiresAt <= now {
			delete(g.states, k)
		}
	}
	if g.states == nil {
		g.states = map[string]oauthState{}
	}
	g.states[state] = oauthState{Redirect: redirect, ExpiresAt: now + oauthStateTTL.Milliseconds()}
	g.mu.Unlock()
	return state, nil
}

func (g *GoogleOAuth) takeState(state string) (string, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	v, ok := g.states[state]
	if !ok {
		return "", false
	}
	delete(g.states, state)
	if v.ExpiresAt <= nowMillis() {
		return "", false
	}
	return v.Redirect, true
}

var (
	errGoogleNotConfigured = errors.New("google not configured")
	errGoogleExchange      = errors.New("google exchange failed")
)

// ---- HTTP handlers ----

func (a *API) authConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		GoogleEnabled bool   `json:"googleEnabled"`
		AuthRequired  bool   `json:"authRequired"`
		Version       string `json:"version"`
	}{a.google != nil && a.google.Configured(), true, apiVersion})
}

func (a *API) googleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	if a.google == nil || !a.google.Configured() {
		writeErr(w, http.StatusServiceUnavailable, "google_not_configured")
		return
	}
	redirectURI, err := a.google.RedirectURI(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "public_url_required")
		return
	}
	redirect := sanitizeLocalRedirect(r.URL.Query().Get("redirect"))
	state, err := a.google.newState(redirect)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not start google sign-in")
		return
	}
	setOAuthStateCookie(w, state)

	q := url.Values{}
	q.Set("client_id", a.google.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("response_type", "code")
	q.Set("scope", "openid email profile")
	q.Set("state", state)
	q.Set("prompt", "select_account")
	http.Redirect(w, r, googleAuthURL+"?"+q.Encode(), http.StatusFound)
}

func (a *API) googleCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	clearOAuthStateCookie(w)
	if a.google == nil || !a.google.Configured() {
		redirectAuthError(w, r, "google_unavailable")
		return
	}

	queryState := r.URL.Query().Get("state")
	cookieState := oauthStateCookieValue(r)
	if queryState == "" || cookieState == "" || !secureStringEqual(queryState, cookieState) {
		redirectAuthError(w, r, "invalid_state")
		return
	}
	redirect, ok := a.google.takeState(queryState)
	if !ok {
		redirectAuthError(w, r, "invalid_state")
		return
	}

	if providerError := r.URL.Query().Get("error"); providerError != "" {
		if providerError == "access_denied" {
			redirectAuthError(w, r, "access_denied")
		} else {
			redirectAuthError(w, r, "exchange_failed")
		}
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		redirectAuthError(w, r, "exchange_failed")
		return
	}
	redirectURI, err := a.google.RedirectURI(r)
	if err != nil {
		redirectAuthError(w, r, "google_unavailable")
		return
	}
	identity, err := a.google.Exchanger.Exchange(r.Context(), code, redirectURI)
	if err != nil {
		redirectAuthError(w, r, "exchange_failed")
		return
	}
	if !identity.EmailVerified {
		redirectAuthError(w, r, "email_unverified")
		return
	}
	_, sessionToken, err := a.accounts.LoginGoogle(identity)
	if err != nil {
		redirectAuthError(w, r, "exchange_failed")
		return
	}
	setSessionCookie(w, sessionToken)
	http.Redirect(w, r, sanitizeLocalRedirect(redirect), http.StatusFound)
}

func redirectAuthError(w http.ResponseWriter, r *http.Request, code string) {
	q := url.Values{}
	q.Set("authError", code)
	http.Redirect(w, r, "/?"+q.Encode(), http.StatusFound)
}

func sanitizeLocalRedirect(raw string) string {
	if raw == "" || len(raw) > 2048 || strings.Contains(raw, "\\") {
		return "/"
	}
	for _, r := range raw {
		if r < 0x20 || r == 0x7f {
			return "/"
		}
	}
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return "/"
	}
	u, err := url.Parse(raw)
	if err != nil || u.IsAbs() || u.Scheme != "" || u.Host != "" {
		return "/"
	}
	return raw
}

func secureStringEqual(a, b string) bool {
	if len(a) != len(b) || a == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func setOAuthStateCookie(w http.ResponseWriter, state string) {
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookie,
		Value:    state,
		Path:     "/api/auth/google",
		MaxAge:   int(oauthStateTTL / time.Second),
		Expires:  time.Now().Add(oauthStateTTL),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearOAuthStateCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookie,
		Value:    "",
		Path:     "/api/auth/google",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func oauthStateCookieValue(r *http.Request) string {
	c, err := r.Cookie(oauthStateCookie)
	if err != nil {
		return ""
	}
	return c.Value
}

// ---- real Google client ----

type httpGoogleExchanger struct {
	clientID     string
	clientSecret string
	client       *http.Client
}

func NewHTTPGoogleExchanger(clientID, clientSecret string) GoogleExchanger {
	return &httpGoogleExchanger{
		clientID:     clientID,
		clientSecret: clientSecret,
		client:       &http.Client{Timeout: 10 * time.Second},
	}
}

func (x *httpGoogleExchanger) Exchange(ctx context.Context, code, redirectURI string) (GoogleIdentity, error) {
	tokenCtx, cancelToken := context.WithTimeout(ctx, 10*time.Second)
	defer cancelToken()
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", x.clientID)
	form.Set("client_secret", x.clientSecret)
	form.Set("redirect_uri", redirectURI)
	form.Set("grant_type", "authorization_code")

	req, err := http.NewRequestWithContext(tokenCtx, http.MethodPost, googleTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return GoogleIdentity{}, errGoogleExchange
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := x.client.Do(req)
	if err != nil {
		return GoogleIdentity{}, errGoogleExchange
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return GoogleIdentity{}, errGoogleExchange
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&token); err != nil || token.AccessToken == "" {
		return GoogleIdentity{}, errGoogleExchange
	}

	userCtx, cancelUser := context.WithTimeout(ctx, 10*time.Second)
	defer cancelUser()
	req, err = http.NewRequestWithContext(userCtx, http.MethodGet, googleUserInfo, nil)
	if err != nil {
		return GoogleIdentity{}, errGoogleExchange
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	req.Header.Set("Accept", "application/json")
	resp2, err := x.client.Do(req)
	if err != nil {
		return GoogleIdentity{}, errGoogleExchange
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp2.Body, 4096))
		return GoogleIdentity{}, errGoogleExchange
	}
	var info struct {
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := json.NewDecoder(io.LimitReader(resp2.Body, 1<<20)).Decode(&info); err != nil {
		return GoogleIdentity{}, errGoogleExchange
	}
	if info.Sub == "" || info.Email == "" {
		return GoogleIdentity{}, errGoogleExchange
	}
	return GoogleIdentity{
		Sub:           info.Sub,
		Email:         info.Email,
		Name:          info.Name,
		EmailVerified: info.EmailVerified,
	}, nil
}
