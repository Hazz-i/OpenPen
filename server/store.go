package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// FileMeta is the public, cheap-to-list description of a design file.
type FileMeta struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	Pinned    bool   `json:"pinned"`
	Draft     bool   `json:"draft"`
	HasThumb  bool   `json:"hasThumb"`
}

// File is the full on-disk record. Doc is opaque JSON owned by the frontend.
type File struct {
	FileMeta
	Doc       json.RawMessage `json:"doc"`
	Thumbnail string          `json:"thumbnail,omitempty"`
}

// AssetMeta describes an uploaded asset. URL is always /api/assets/{id}.
type AssetMeta struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	URL       string `json:"url"`
	Size      int64  `json:"size"`
	CreatedAt int64  `json:"createdAt"`
}

// Usage is the per-user quota snapshot returned by the API.
type Usage struct {
	UsedBytes  int64 `json:"usedBytes"`
	LimitBytes int64 `json:"limitBytes"`
	Percent    int   `json:"percent"`
	FileCount  int   `json:"fileCount"`
	AssetCount int   `json:"assetCount"`
}

var (
	errNotFound = errors.New("not found")
	errExists   = errors.New("already exists")
	errInvalid  = errors.New("invalid id")
	errQuota    = errors.New("quota exceeded")
)

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func validID(id string) bool { return idPattern.MatchString(id) }

const idAlphabet = "abcdefghijklmnopqrstuvwxyz234567"

func newID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = idAlphabet[b[i]&31]
	}
	return string(b[:]), nil
}

func nowMillis() int64 { return time.Now().UnixMilli() }

func hasThumb(s string) bool {
	return s != "" && strings.HasPrefix(strings.ToLower(s), "data:image/")
}

// Store owns one user's data directory. Mutations are serialized by mu, which
// also guards the cached usage counters used for quota checks.
type Store struct {
	filesDir  string
	assetsDir string
	settings  string
	assetIdx  string

	mu          sync.RWMutex
	assets      []AssetMeta
	settingsRaw json.RawMessage
	usedBytes   int64
	fileCount   int
	assetCount  int
	usageReady  bool
}

func NewStore(root string) (*Store, error) {
	s := &Store{
		filesDir:  filepath.Join(root, "files"),
		assetsDir: filepath.Join(root, "assets"),
		settings:  filepath.Join(root, "settings.json"),
		assetIdx:  filepath.Join(root, "assets", "index.json"),
		assets:    []AssetMeta{},
	}
	for _, dir := range []string{root, s.filesDir, s.assetsDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	if b, err := os.ReadFile(s.assetIdx); err == nil {
		var list []AssetMeta
		if json.Unmarshal(b, &list) == nil {
			for _, a := range list {
				if !validID(a.ID) {
					continue
				}
				a.URL = "/api/assets/" + a.ID
				s.assets = append(s.assets, a)
			}
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	if b, err := os.ReadFile(s.settings); err == nil && isJSONObject(b) {
		s.settingsRaw = append(json.RawMessage(nil), b...)
	}
	if err := s.recomputeUsageLocked(); err != nil {
		return nil, err
	}
	s.usageReady = true
	return s, nil
}

func (s *Store) filePath(id string) (string, error) {
	if !validID(id) {
		return "", errInvalid
	}
	return filepath.Join(s.filesDir, id+".json"), nil
}

// Usage returns the cached usage snapshot. limit==0 means unlimited.
func (s *Store) Usage(limit int64) Usage {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureUsageLocked()
	u := Usage{
		UsedBytes:  s.usedBytes,
		LimitBytes: limit,
		FileCount:  s.fileCount,
		AssetCount: s.assetCount,
	}
	if limit > 0 {
		p := int(s.usedBytes * 100 / limit)
		if p > 100 {
			p = 100
		}
		u.Percent = p
	}
	return u
}

func (s *Store) ensureUsageLocked() {
	if s.usageReady {
		return
	}
	if err := s.recomputeUsageLocked(); err == nil {
		s.usageReady = true
	}
}

func (s *Store) recomputeUsageLocked() error {
	var used int64
	var files int
	entries, err := os.ReadDir(s.filesDir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		used += info.Size()
		files++
	}
	for _, a := range s.assets {
		used += a.Size
	}
	s.usedBytes = used
	s.fileCount = files
	s.assetCount = len(s.assets)
	s.usageReady = true
	return nil
}

func overQuota(limit, used, delta int64) bool {
	return limit > 0 && delta > 0 && used+delta > limit
}

// CreateFile writes a new file. Existing ids are rejected with errExists.
func (s *Store) CreateFile(f *File, limit int64) error {
	p, err := s.filePath(f.ID)
	if err != nil {
		return err
	}
	f.HasThumb = hasThumb(f.Thumbnail)
	data, err := json.Marshal(f)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureUsageLocked()
	if _, err := os.Stat(p); err == nil {
		return errExists
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if overQuota(limit, s.usedBytes, int64(len(data))) {
		return errQuota
	}
	if err := writeAtomic(p, data); err != nil {
		return err
	}
	s.usedBytes += int64(len(data))
	s.fileCount++
	return nil
}

func (s *Store) GetFile(id string) (*File, error) {
	p, err := s.filePath(id)
	if err != nil {
		return nil, err
	}
	return readFileRecord(p)
}

func (s *Store) ListFiles() ([]FileMeta, error) {
	entries, err := os.ReadDir(s.filesDir)
	if err != nil {
		return nil, err
	}
	out := make([]FileMeta, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".json")
		if !validID(id) {
			continue
		}
		f, err := readFileRecord(filepath.Join(s.filesDir, e.Name()))
		if err != nil {
			continue // ignore a corrupt file rather than breaking the list
		}
		f.ID = id
		f.HasThumb = hasThumb(f.Thumbnail)
		out = append(out, f.FileMeta)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].UpdatedAt != out[j].UpdatedAt {
			return out[i].UpdatedAt > out[j].UpdatedAt
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// UpdateFile applies a mutation under the write lock. Missing ids return errNotFound.
func (s *Store) UpdateFile(id string, apply func(*File) error, limit int64) (*File, error) {
	return s.mutateFile(id, false, apply, limit)
}

// UpsertFile updates an existing file or creates it with sane defaults.
func (s *Store) UpsertFile(id string, apply func(*File) error, limit int64) (*File, error) {
	return s.mutateFile(id, true, apply, limit)
}

func (s *Store) mutateFile(id string, create bool, apply func(*File) error, limit int64) (*File, error) {
	p, err := s.filePath(id)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureUsageLocked()

	var oldSize int64
	created := false
	f, err := readFileRecord(p)
	switch {
	case errors.Is(err, errNotFound) && create:
		now := nowMillis()
		f = &File{FileMeta: FileMeta{ID: id, Name: "Untitled", CreatedAt: now, UpdatedAt: now}}
		created = true
	case errors.Is(err, errNotFound):
		return nil, errNotFound
	case err != nil:
		return nil, err
	}
	if !created {
		info, err := os.Stat(p)
		if err != nil {
			return nil, err
		}
		oldSize = info.Size()
	}
	if err := apply(f); err != nil {
		return nil, err
	}
	f.HasThumb = hasThumb(f.Thumbnail)
	data, err := json.Marshal(f)
	if err != nil {
		return nil, err
	}
	if overQuota(limit, s.usedBytes, int64(len(data))-oldSize) {
		return nil, errQuota
	}
	if err := writeAtomic(p, data); err != nil {
		return nil, err
	}
	s.usedBytes += int64(len(data)) - oldSize
	if created {
		s.fileCount++
	}
	return f, nil
}

func (s *Store) DeleteFile(id string) error {
	p, err := s.filePath(id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureUsageLocked()
	info, err := os.Stat(p)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return errNotFound
		}
		return err
	}
	if err := os.Remove(p); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return errNotFound
		}
		return err
	}
	s.usedBytes -= info.Size()
	if s.usedBytes < 0 {
		s.usedBytes = 0
	}
	if s.fileCount > 0 {
		s.fileCount--
	}
	return nil
}

func (s *Store) DuplicateFile(id string, limit int64) (*File, error) {
	srcPath, err := s.filePath(id)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureUsageLocked()
	src, err := readFileRecord(srcPath)
	if err != nil {
		return nil, err
	}
	newIdent, err := newID()
	if err != nil {
		return nil, err
	}
	now := nowMillis()
	cp := *src
	cp.ID = newIdent
	cp.Name = copyName(src.Name)
	cp.CreatedAt = now
	cp.UpdatedAt = now
	cp.Pinned = false
	cp.HasThumb = hasThumb(cp.Thumbnail)
	data, err := json.Marshal(&cp)
	if err != nil {
		return nil, err
	}
	if overQuota(limit, s.usedBytes, int64(len(data))) {
		return nil, errQuota
	}
	p := filepath.Join(s.filesDir, newIdent+".json")
	if err := writeAtomic(p, data); err != nil {
		return nil, err
	}
	s.usedBytes += int64(len(data))
	s.fileCount++
	return &cp, nil
}

func readFileRecord(p string) (*File, error) {
	b, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, errNotFound
		}
		return nil, err
	}
	var f File
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(f.Doc)) == 0 || string(bytes.TrimSpace(f.Doc)) == "null" {
		f.Doc = json.RawMessage(`{}`)
	}
	f.HasThumb = hasThumb(f.Thumbnail)
	return &f, nil
}

func copyName(name string) string {
	const suffix = " copy"
	r := []rune(name)
	if len(r)+len(suffix) > 200 {
		r = r[:200-len(suffix)]
	}
	return string(r) + suffix
}

// ---- assets ----

func (s *Store) AddAsset(meta AssetMeta, data []byte, limit int64) error {
	if !validID(meta.ID) {
		return errInvalid
	}
	p := s.assetPath(meta.ID, meta.Name)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureUsageLocked()
	if overQuota(limit, s.usedBytes, int64(len(data))) {
		return errQuota
	}
	if err := writeAtomic(p, data); err != nil {
		return err
	}
	next := make([]AssetMeta, len(s.assets), len(s.assets)+1)
	copy(next, s.assets)
	next = append(next, meta)
	if err := s.saveAssetsLocked(next); err != nil {
		_ = os.Remove(p)
		return err
	}
	s.assets = next
	s.usedBytes += int64(len(data))
	s.assetCount++
	return nil
}

func (s *Store) ListAssets() []AssetMeta {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]AssetMeta, len(s.assets))
	copy(out, s.assets)
	return out
}

func (s *Store) GetAsset(id string) (AssetMeta, []byte, error) {
	if !validID(id) {
		return AssetMeta{}, nil, errInvalid
	}
	s.mu.RLock()
	var meta AssetMeta
	found := false
	for _, a := range s.assets {
		if a.ID == id {
			meta, found = a, true
			break
		}
	}
	s.mu.RUnlock()
	if !found {
		return AssetMeta{}, nil, errNotFound
	}
	matches, _ := filepath.Glob(filepath.Join(s.assetsDir, id+"-*"))
	if len(matches) == 0 {
		return AssetMeta{}, nil, errNotFound
	}
	data, err := os.ReadFile(matches[0])
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return AssetMeta{}, nil, errNotFound
		}
		return AssetMeta{}, nil, err
	}
	return meta, data, nil
}

func (s *Store) DeleteAsset(id string) error {
	if !validID(id) {
		return errInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureUsageLocked()
	idx := -1
	for i, a := range s.assets {
		if a.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return errNotFound
	}
	meta := s.assets[idx]
	next := make([]AssetMeta, 0, len(s.assets)-1)
	next = append(next, s.assets[:idx]...)
	next = append(next, s.assets[idx+1:]...)
	if err := s.saveAssetsLocked(next); err != nil {
		return err
	}
	s.assets = next
	matches, _ := filepath.Glob(filepath.Join(s.assetsDir, id+"-*"))
	for _, p := range matches {
		_ = os.Remove(p)
	}
	s.usedBytes -= meta.Size
	if s.usedBytes < 0 {
		s.usedBytes = 0
	}
	if s.assetCount > 0 {
		s.assetCount--
	}
	return nil
}

func (s *Store) saveAssetsLocked(list []AssetMeta) error {
	data, err := json.Marshal(list)
	if err != nil {
		return err
	}
	return writeAtomic(s.assetIdx, data)
}

func (s *Store) assetPath(id, name string) string {
	return filepath.Join(s.assetsDir, id+"-"+safeAssetName(name))
}

func safeAssetName(name string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '_', r == '-':
			b.WriteRune(r)
		case r == ' ':
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), ".")
	if out == "" {
		return "asset"
	}
	if len(out) > 80 {
		out = out[:80]
	}
	return out
}

// ---- settings ----

func (s *Store) GetSettings() json.RawMessage {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.settingsRaw == nil {
		return nil
	}
	return append(json.RawMessage(nil), s.settingsRaw...)
}

func (s *Store) SetSettings(raw json.RawMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := writeAtomic(s.settings, raw); err != nil {
		return err
	}
	s.settingsRaw = append(json.RawMessage(nil), raw...)
	return nil
}

// writeAtomic writes via a temp file in the same directory, fsyncs, then renames.
func writeAtomic(p string, data []byte) error {
	dir := filepath.Dir(p)
	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer func() { _ = os.Remove(tmp) }()
	if err := f.Chmod(0o644); err != nil {
		_ = f.Close()
		return err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		return err
	}
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}

func isJSONObject(b []byte) bool {
	b = bytes.TrimSpace(b)
	return len(b) > 0 && b[0] == '{' && json.Valid(b)
}

func truncateName(name string) string {
	r := []rune(name)
	if len(r) > 200 {
		return string(r[:200])
	}
	return name
}

func nameLen(name string) int { return utf8.RuneCountInString(name) }
