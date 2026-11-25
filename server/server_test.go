package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testOrigin = "https://books.example.test"

func testLibrary(t *testing.T) *service {
	t.Helper()
	dir := t.TempDir()
	put(t, dir, ".obsidian-library", "")
	return &service{root: dir, marker: ".obsidian-library", reads: make(chan struct{}, 2)}
}

func put(t *testing.T, directory, name, contents string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(directory, name), []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
}

func scanTestLibrary(t *testing.T, s *service, previous index) index {
	t.Helper()
	root, err := s.openRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	next, err := scan(root, previous, testOrigin)
	if err != nil {
		t.Fatal(err)
	}
	s.catalog.Store(&next)
	return next
}

func TestHealthReportsCatalogVersion(t *testing.T) {
	s := testLibrary(t)
	put(t, s.root, "book.pdf", "%PDF-1.7 example")
	catalog := scanTestLibrary(t, s, index{})
	s.ready.Store(true)
	response := httptest.NewRecorder()
	s.routes("").ServeHTTP(response, httptest.NewRequest("GET", "/health", nil))

	var health struct {
		CatalogReady   bool   `json:"catalogReady"`
		CatalogVersion string `json:"catalogVersion"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &health); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || !health.CatalogReady || health.CatalogVersion != catalog.Version {
		t.Fatalf("unexpected health response: %d %s", response.Code, response.Body)
	}
}

func TestScanPreservesIdentity(t *testing.T) {
	s := testLibrary(t)
	put(t, s.root, "book.pdf", "%PDF-1.7 example")
	initial := scanTestLibrary(t, s, index{})
	file := filepath.Join(t.TempDir(), "catalog.json")
	if err := saveIndex(file, initial); err != nil {
		t.Fatal(err)
	}
	saved, err := loadIndex(file)
	if err != nil || saved.Books[0].ID != initial.Books[0].ID {
		t.Fatalf("could not restore persisted ID: %v", err)
	}
	if err := os.Rename(filepath.Join(s.root, "book.pdf"), filepath.Join(s.root, "renamed.pdf")); err != nil {
		t.Fatal(err)
	}
	moved := scanTestLibrary(t, s, saved)
	if len(moved.Books) != 1 || moved.Books[0].ID != initial.Books[0].ID || moved.Books[0].Title != "renamed" {
		t.Fatalf("unexpected move result: %+v", moved)
	}
	if err := os.Remove(filepath.Join(s.root, "renamed.pdf")); err != nil {
		t.Fatal(err)
	}
	missing := scanTestLibrary(t, s, moved)
	if len(missing.Books) != 1 || missing.Books[0].Availability != "missing" {
		t.Fatalf("expected a preserved unavailable record: %+v", missing)
	}
}

func TestRangeAndUnavailableDisk(t *testing.T) {
	s := testLibrary(t)
	put(t, s.root, "book.pdf", "%PDF-1.7 sample content")
	current := scanTestLibrary(t, s, index{})
	target := current.Books[0].ReadURL
	handler := s.routes("app://obsidian.md")
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.Header.Set("Range", "bytes=0-7")
	request.Header.Set("Origin", "app://obsidian.md")
	result := httptest.NewRecorder()
	handler.ServeHTTP(result, request)
	if result.Code != 206 || result.Body.String() != "%PDF-1.7" ||
		result.Header().Get("Content-Range") != "bytes 0-7/23" ||
		result.Header().Get("ETag") != current.Books[0].ETag ||
		result.Header().Get("Access-Control-Allow-Origin") != "app://obsidian.md" {
		t.Fatalf("unexpected range: %d %v %s", result.Code, result.Header(), result.Body)
	}
	if err := os.Remove(filepath.Join(s.root, s.marker)); err != nil {
		t.Fatal(err)
	}
	result = httptest.NewRecorder()
	handler.ServeHTTP(result, request)
	if result.Code != 503 || s.catalog.Load().Version != current.Version {
		t.Fatalf("missing disk should preserve catalog and prevent reads: %d", result.Code)
	}
}

func TestCursorInvalidatedAndPathsPrivate(t *testing.T) {
	s := testLibrary(t)
	for i := range 101 {
		put(t, s.root, fmt.Sprintf("%03d.pdf", i), fmt.Sprintf("%%PDF-1.7 %d", i))
	}
	first := scanTestLibrary(t, s, index{})
	handler := s.routes("")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/books", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), first.Version+":100") ||
		strings.Contains(response.Body.String(), `"path":`) {
		t.Fatalf("unexpected catalog response: %d", response.Code)
	}
	put(t, s.root, "new.pdf", "%PDF-1.7 new")
	scanTestLibrary(t, s, first)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/books?cursor="+first.Version+":100", nil))
	if response.Code != 409 {
		t.Fatalf("expected stale cursor conflict, got %d", response.Code)
	}
}

func TestRootRejectsOutsideSymlink(t *testing.T) {
	s := testLibrary(t)
	outside := t.TempDir()
	put(t, outside, "book.pdf", "%PDF-1.7 outside")
	if err := os.Symlink(outside, filepath.Join(s.root, "linked")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	root, err := s.openRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	file, err := root.Open("linked/book.pdf")
	if err == nil {
		file.Close()
		t.Fatal("root allowed access outside the library")
	}
	if next := scanTestLibrary(t, s, index{}); len(next.Books) != 0 {
		t.Fatal("scan indexed a file outside the library")
	}
}

func TestRootRejectsPathsOutsideLibrary(t *testing.T) {
	s := testLibrary(t)
	root, err := s.openRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, name := range []string{"../", filepath.Dir(s.root)} {
		file, err := root.Open(name)
		if err == nil {
			file.Close()
			t.Fatalf("root accepted an out-of-library path: %s", name)
		}
	}
}

func TestInvalidPDFReturnsUnsupportedMediaType(t *testing.T) {
	s := testLibrary(t)
	put(t, s.root, "broken.pdf", "not a PDF")
	current := scanTestLibrary(t, s, index{})
	response := httptest.NewRecorder()
	s.routes("").ServeHTTP(response, httptest.NewRequest("HEAD", current.Books[0].ReadURL, nil))
	if response.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected invalid PDF to be rejected, got %d", response.Code)
	}
}
