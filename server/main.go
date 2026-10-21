package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

//go:embed all:web
var webAssets embed.FS

func main() {
	defaultQuota, err := envInt64("PENCLONE_FREE_QUOTA", 5*1024*1024*1024)
	if err != nil {
		slog.Error("invalid PENCLONE_FREE_QUOTA", "err", err)
		os.Exit(2)
	}
	addr := flag.String("addr", envOr("PENCLONE_ADDR", "127.0.0.1:8787"), "listen address")
	data := flag.String("data", envOr("PENCLONE_DATA", "./data"), "data directory")
	web := flag.String("web", envOr("PENCLONE_WEB", ""), "serve frontend from this directory (dev mode)")
	freeQuota := flag.Int64("free-quota-bytes", defaultQuota, "free plan storage limit in bytes")
	googleID := flag.String("google-client-id", envOr("GOOGLE_CLIENT_ID", ""), "Google OAuth client id")
	googleSecret := flag.String("google-client-secret", envOr("GOOGLE_CLIENT_SECRET", ""), "Google OAuth client secret")
	publicURL := flag.String("public-url", envOr("PENCLONE_PUBLIC_URL", ""), "public base URL for OAuth redirects")
	allowLocalImports := flag.Bool("allow-local-imports",
		envBool("PENCLONE_ALLOW_LOCAL_IMPORTS", false), "allow URL imports from loopback addresses")
	flag.Parse()

	if err := run(*addr, *data, *web, *freeQuota, *googleID, *googleSecret, *publicURL, *allowLocalImports); err != nil {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}

func run(addr, dataDir, webDir string, freeQuota int64, googleID, googleSecret, publicURL string, allowLocalImports bool) error {
	accounts, err := NewAccounts(dataDir, freeQuota)
	if err != nil {
		return fmt.Errorf("data directory: %w", err)
	}

	webFS, webLabel := embeddedWeb(), "embedded"
	if webDir != "" {
		info, err := os.Stat(webDir)
		if err != nil {
			return fmt.Errorf("web directory: %w", err)
		}
		if !info.IsDir() {
			return fmt.Errorf("web path is not a directory: %s", webDir)
		}
		webFS = os.DirFS(webDir)
		webLabel = webDir
	}

	google := NewGoogleOAuth(googleID, googleSecret, publicURL, nil)
	api := NewAPI(accounts, webFS, google)
	api.imports = NewImportService(allowLocalImports)
	srv := &http.Server{
		Addr:              addr,
		Handler:           api,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()

	slog.Info("listening", "addr", addr, "data", dataDir, "web", webLabel,
		"freeQuotaBytes", freeQuota, "googleSignIn", google.Configured(),
		"allowLocalImports", allowLocalImports)
	if !isLoopback(addr) {
		slog.Warn("listening on a non-loopback address", "addr", addr)
	}

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		slog.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			_ = srv.Close()
			return err
		}
		return nil
	}
}

func embeddedWeb() fs.FS {
	sub, err := fs.Sub(webAssets, "web")
	if err != nil {
		return os.DirFS("web") // cannot happen: the directory is embedded at build time
	}
	return sub
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		slog.Error("invalid boolean env", "key", key, "value", v)
		os.Exit(2)
	}
	return b
}

func envInt64(key string, fallback int64) (int64, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer", key)
	}
	return n, nil
}

func isLoopback(addr string) bool {
	host := addr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		host = host[:i]
	}
	host = strings.Trim(host, "[]")
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
