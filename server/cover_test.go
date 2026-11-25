package main

import (
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCoverSidecarTakesPriority(t *testing.T) {
	s := testLibrary(t)
	put(t, s.root, "Book.pdf", "%PDF-1.7 example")
	file, err := os.Create(filepath.Join(s.root, "Book.cover.png"))
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(file, image.NewRGBA(image.Rect(0, 0, 2, 3))); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	catalog := scanTestLibrary(t, s, index{})
	book := &catalog.Books[0]
	book.PageCount = 3
	response := httptest.NewRecorder()
	s.routes("").ServeHTTP(response, httptest.NewRequest("GET", book.CoverURL+"?page=2", nil))
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("expected sidecar PNG, got %d %v", response.Code, response.Header())
	}
}

func TestCoverReturnsCachedSelectedPage(t *testing.T) {
	s := testLibrary(t)
	s.covers = t.TempDir()
	put(t, s.root, "Book.pdf", "%PDF-1.7 example")
	catalog := scanTestLibrary(t, s, index{})
	book := &catalog.Books[0]
	book.PageCount = 3
	file, err := os.Create(generatedCoverPath(s.covers, book.Hash, 2))
	if err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(file, image.NewRGBA(image.Rect(0, 0, 240, 480)), nil); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	target := strings.TrimSuffix(book.ReadURL, "/file") + "/cover"
	response := httptest.NewRecorder()
	s.routes("").ServeHTTP(response, httptest.NewRequest("GET", target+"?page=2", nil))
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("expected cached JPEG, got %d %v", response.Code, response.Header())
	}
	response = httptest.NewRecorder()
	s.routes("").ServeHTTP(response, httptest.NewRequest("GET", target+"?page=12", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid page to be rejected, got %d", response.Code)
	}
}
