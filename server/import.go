package main

import (
	"context"
	"encoding/json"
	"errors"
	htmlstd "html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	maxFigmaBytes   = 25 << 20
	maxURLBytes     = 2 << 20
	figmaTimeout    = 20 * time.Second
	urlFetchTimeout = 10 * time.Second
	importMaxTries  = 10
	importWindow    = time.Minute
	maxRedirects    = 5
)

var (
	errImportTooLarge     = errors.New("import response too large")
	errImportTimeout      = errors.New("import timed out")
	errImportNetwork      = errors.New("import network failure")
	errImportLocalBlocked = errors.New("local imports disabled")
	errImportAddrBlocked  = errors.New("blocked import address")
	errImportBadURL       = errors.New("invalid import url")
	errImportRedirects    = errors.New("too many redirects")

	figmaKeyRe  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	figmaNodeRe = regexp.MustCompile(`^[A-Za-z0-9:_-]{1,128}$`)
	titleRe     = regexp.MustCompile(`(?is)<title\b[^>]*>(.*?)</title>`)
	metaRe      = regexp.MustCompile(`(?is)<meta\b[^>]*>`)
	attrRe      = regexp.MustCompile(`(?is)([a-z_:][-a-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`)
)

// ImportService holds import limits, safe HTTP clients and the per-user limiter.
type ImportService struct {
	allowLocal bool
	figmaBase  string
	figmaHTTP  *http.Client
	urlHTTP    *http.Client
	limiter    *importRateLimiter
}

func NewImportService(allowLocal bool) *ImportService {
	return &ImportService{
		allowLocal: allowLocal,
		figmaBase:  "https://api.figma.com",
		figmaHTTP: &http.Client{
			Timeout:       figmaTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		urlHTTP: &http.Client{
			Timeout:       urlFetchTimeout,
			Transport:     newImportTransport(allowLocal),
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		limiter: newImportRateLimiter(),
	}
}

type importRateLimiter struct {
	mu     sync.Mutex
	byUser map[string][]time.Time
}

func newImportRateLimiter() *importRateLimiter {
	return &importRateLimiter{byUser: map[string][]time.Time{}}
}

func (l *importRateLimiter) allow(userID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-importWindow)
	list := l.byUser[userID][:0]
	for _, t := range l.byUser[userID] {
		if t.After(cutoff) {
			list = append(list, t)
		}
	}
	if len(list) >= importMaxTries {
		l.byUser[userID] = list
		return false
	}
	l.byUser[userID] = append(list, now)
	return true
}

// ---- routing ----

func (a *API) importRoutes(w http.ResponseWriter, r *http.Request, tail []string) {
	ai := authFrom(r)
	if ai == nil {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if len(tail) != 1 {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	switch tail[0] {
	case "config":
		if r.Method != http.MethodGet {
			methodNotAllowed(w, "GET")
			return
		}
		writeJSON(w, http.StatusOK, struct {
			AllowLocalImports bool `json:"allowLocalImports"`
		}{a.imports.allowLocal})
	case "figma":
		if r.Method != http.MethodPost {
			methodNotAllowed(w, "POST")
			return
		}
		if !a.imports.limiter.allow(ai.user.ID) {
			writeErr(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		a.importFigma(w, r)
	case "url":
		if r.Method != http.MethodPost {
			methodNotAllowed(w, "POST")
			return
		}
		if !a.imports.limiter.allow(ai.user.ID) {
			writeErr(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		a.importURL(w, r)
	default:
		writeErr(w, http.StatusNotFound, "not found")
	}
}

// ---- Figma ----

func (a *API) importFigma(w http.ResponseWriter, r *http.Request) {
	var req struct {
		FileKey string `json:"fileKey"`
		URL     string `json:"url"`
		Token   string `json:"token"`
		NodeID  string `json:"nodeId"`
	}
	if err := decodeJSON(w, r, &req, 64<<10); err != nil {
		writeDecodeErr(w, err)
		return
	}
	token := strings.TrimSpace(req.Token)
	if token == "" {
		writeErr(w, http.StatusBadRequest, "figma_token_required")
		return
	}
	if strings.ContainsAny(token, "\r\n") {
		writeErr(w, http.StatusBadRequest, "invalid_token")
		return
	}
	key, err := extractFigmaKey(req.FileKey, req.URL)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_figma_url")
		return
	}
	nodeID := strings.TrimSpace(req.NodeID)
	if nodeID != "" && !figmaNodeRe.MatchString(nodeID) {
		writeErr(w, http.StatusBadRequest, "invalid_node_id")
		return
	}

	target := strings.TrimRight(a.imports.figmaBase, "/") + "/v1/files/" + url.PathEscape(key)
	query := url.Values{}
	query.Set("geometry", "paths")
	if nodeID != "" {
		target += "/nodes"
		query.Set("ids", nodeID)
	}
	target += "?" + query.Encode()

	ctx, cancel := context.WithTimeout(r.Context(), figmaTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "figma_unavailable")
		return
	}
	httpReq.Header.Set("X-Figma-Token", token)
	httpReq.Header.Set("Accept", "application/json")

	resp, err := a.imports.figmaHTTP.Do(httpReq)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "figma_unavailable")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		writeErr(w, http.StatusUnauthorized, "figma_unauthorized")
		return
	}
	if resp.StatusCode != http.StatusOK {
		writeErr(w, http.StatusBadGateway, "figma_unavailable")
		return
	}
	if resp.ContentLength > maxFigmaBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "figma_too_large")
		return
	}
	body, err := readCapped(resp.Body, maxFigmaBytes)
	if err != nil {
		if errors.Is(err, errImportTooLarge) {
			writeErr(w, http.StatusRequestEntityTooLarge, "figma_too_large")
		} else {
			writeErr(w, http.StatusBadGateway, "figma_unavailable")
		}
		return
	}
	if !json.Valid(body) {
		writeErr(w, http.StatusBadGateway, "figma_unavailable")
		return
	}
	if nodeID != "" {
		var parsed struct {
			Nodes json.RawMessage `json:"nodes"`
		}
		if err := json.Unmarshal(body, &parsed); err != nil || len(parsed.Nodes) == 0 || string(parsed.Nodes) == "null" {
			writeErr(w, http.StatusBadGateway, "figma_unavailable")
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Nodes json.RawMessage `json:"nodes"`
		}{parsed.Nodes})
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Document json.RawMessage `json:"document"`
	}{json.RawMessage(body)})
}

func extractFigmaKey(fileKey, rawURL string) (string, error) {
	if strings.TrimSpace(fileKey) != "" {
		key := strings.TrimSpace(fileKey)
		if figmaKeyRe.MatchString(key) {
			return key, nil
		}
		return "", errImportBadURL
	}
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", errImportBadURL
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.User != nil {
		return "", errImportBadURL
	}
	host := strings.ToLower(u.Hostname())
	if (host != "figma.com" && host != "www.figma.com") || u.Port() != "" {
		return "", errImportBadURL
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 || (parts[0] != "file" && parts[0] != "design") {
		return "", errImportBadURL
	}
	key := parts[1]
	if !figmaKeyRe.MatchString(key) {
		return "", errImportBadURL
	}
	return key, nil
}

// ---- URL import ----

type importURLResponse struct {
	URL         string `json:"url"`
	FinalURL    string `json:"finalUrl"`
	Status      int    `json:"status"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
	ThemeColor  string `json:"themeColor"`
	HTML        string `json:"html"`
}

func (a *API) importURL(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := decodeJSON(w, r, &req, 64<<10); err != nil {
		writeDecodeErr(w, err)
		return
	}
	raw := strings.TrimSpace(req.URL)
	parsed, err := url.Parse(raw)
	if err != nil || validateImportURL(parsed) != nil {
		writeErr(w, http.StatusBadRequest, "invalid_url")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), urlFetchTimeout)
	defer cancel()
	result, err := a.imports.fetchPage(ctx, raw, parsed)
	if err != nil {
		switch {
		case errors.Is(err, errImportLocalBlocked):
			writeErr(w, http.StatusBadRequest, "local_import_disabled")
		case errors.Is(err, errImportAddrBlocked), errors.Is(err, errImportBadURL):
			writeErr(w, http.StatusBadRequest, "invalid_url")
		case errors.Is(err, errImportTooLarge):
			writeErr(w, http.StatusRequestEntityTooLarge, "response_too_large")
		case errors.Is(err, errImportTimeout):
			writeErr(w, http.StatusGatewayTimeout, "fetch_timeout")
		default:
			writeErr(w, http.StatusBadGateway, "fetch_failed")
		}
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func validateImportURL(u *url.URL) error {
	if u == nil || (u.Scheme != "http" && u.Scheme != "https") {
		return errImportBadURL
	}
	if u.Host == "" || u.Hostname() == "" || u.User != nil {
		return errImportBadURL
	}
	if len(u.String()) > 2048 {
		return errImportBadURL
	}
	return nil
}

func (s *ImportService) fetchPage(ctx context.Context, raw string, start *url.URL) (importURLResponse, error) {
	current := start
	redirects := 0
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, current.String(), nil)
		if err != nil {
			return importURLResponse{}, errImportBadURL
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
		req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

		resp, err := s.urlHTTP.Do(req)
		if err != nil {
			return importURLResponse{}, classifyImportError(err)
		}

		if isRedirectStatus(resp.StatusCode) {
			location := resp.Header.Get("Location")
			_ = resp.Body.Close()
			if location == "" {
				return importURLResponse{}, errImportBadURL
			}
			if redirects >= maxRedirects {
				return importURLResponse{}, errImportRedirects
			}
			next, err := current.Parse(location)
			if err != nil {
				return importURLResponse{}, errImportBadURL
			}
			if err := validateImportURL(next); err != nil {
				return importURLResponse{}, errImportBadURL
			}
			current = next
			redirects++
			continue
		}

		if resp.ContentLength > maxURLBytes {
			_ = resp.Body.Close()
			return importURLResponse{}, errImportTooLarge
		}
		body, err := readCapped(resp.Body, maxURLBytes)
		_ = resp.Body.Close()
		if err != nil {
			if errors.Is(err, errImportTooLarge) {
				return importURLResponse{}, errImportTooLarge
			}
			return importURLResponse{}, classifyImportError(err)
		}
		title, description, image, themeColor := extractPageMeta(body)
		return importURLResponse{
			URL:         raw,
			FinalURL:    current.String(),
			Status:      resp.StatusCode,
			Title:       title,
			Description: description,
			Image:       image,
			ThemeColor:  themeColor,
			HTML:        string(body),
		}, nil
	}
}

func isRedirectStatus(code int) bool {
	switch code {
	case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther,
		http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		return true
	}
	return false
}

func classifyImportError(err error) error {
	if errors.Is(err, errImportLocalBlocked) || errors.Is(err, errImportAddrBlocked) ||
		errors.Is(err, errImportTooLarge) || errors.Is(err, errImportBadURL) ||
		errors.Is(err, errImportRedirects) {
		return err
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errImportTimeout
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return errImportTimeout
	}
	return errImportNetwork
}

func readCapped(r io.Reader, max int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, errImportTooLarge
	}
	return data, nil
}

// newImportTransport refuses private, link-local and metadata destinations.
func newImportTransport(allowLocal bool) *http.Transport {
	dialer := &net.Dialer{Timeout: urlFetchTimeout, KeepAlive: 30 * time.Second}
	return &http.Transport{
		Proxy:                 nil,
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		IdleConnTimeout:       30 * time.Second,
		MaxIdleConns:          10,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			for _, ipa := range ips {
				if ipa.IP.IsLoopback() {
					if !allowLocal {
						return nil, errImportLocalBlocked
					}
					continue
				}
				if blockedImportIP(ipa.IP) {
					return nil, errImportAddrBlocked
				}
			}
			var lastErr error
			for _, ipa := range ips {
				conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ipa.IP.String(), port))
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			if lastErr == nil {
				lastErr = errImportNetwork
			}
			return nil, lastErr
		},
	}
}

func blockedImportIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() {
		return false // handled by the allowLocal check
	}
	return ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() || ip.IsMulticast() || ip.Equal(net.IPv4bcast)
}

// ---- HTML metadata ----

func extractPageMeta(body []byte) (title, description, image, themeColor string) {
	if m := titleRe.FindSubmatch(body); len(m) == 2 {
		title = cleanMeta(string(m[1]))
	}
	ogTitle := ""
	for _, tag := range metaRe.FindAll(body, -1) {
		attrs := parseMetaAttrs(string(tag))
		key := attrs["property"]
		if key == "" {
			key = attrs["name"]
		}
		value := cleanMeta(attrs["content"])
		if value == "" {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "og:title":
			ogTitle = value
		case "description", "og:description":
			if description == "" {
				description = value
			}
		case "og:image", "twitter:image", "twitter:image:src":
			if image == "" {
				image = value
			}
		case "theme-color":
			if themeColor == "" {
				themeColor = value
			}
		}
	}
	if title == "" {
		title = ogTitle
	}
	return title, description, image, themeColor
}

func parseMetaAttrs(tag string) map[string]string {
	out := map[string]string{}
	for _, m := range attrRe.FindAllStringSubmatch(tag, -1) {
		if len(m) < 5 {
			continue
		}
		value := m[2]
		if value == "" {
			value = m[3]
		}
		if value == "" {
			value = m[4]
		}
		out[strings.ToLower(m[1])] = value
	}
	return out
}

func cleanMeta(s string) string {
	return strings.Join(strings.Fields(htmlstd.UnescapeString(s)), " ")
}
