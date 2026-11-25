package main

import "testing"

func TestPDFMetadata(t *testing.T) {
	entry := record{book: book{Title: "filename"}}
	applyPDFInfo(&entry, []byte("Title:   Aprendendo Go\nAuthor:  Ana Silva\nPages:   137\n"))
	if entry.Title != "Aprendendo Go" || entry.Author != "Ana Silva" || entry.PageCount != 137 {
		t.Fatalf("metadata not extracted: %+v", entry)
	}
}

func TestPDFMetadataSurvivesRescan(t *testing.T) {
	s := testLibrary(t)
	put(t, s.root, "example.pdf", "%PDF-1.7 example")
	first := scanTestLibrary(t, s, index{})
	entry := &first.Books[0]
	entry.MetadataScanned = true
	entry.Title = "Original title"
	entry.Author = "Author"
	entry.PageCount = 23
	next := scanTestLibrary(t, s, first)
	if next.Version != first.Version || next.Books[0] != *entry {
		t.Fatalf("rescan replaced stored metadata: %+v", next)
	}
	put(t, s.root, "example.pdf", "%PDF-1.7 different content")
	next = scanTestLibrary(t, s, next)
	if next.Books[0].ID != entry.ID || next.Books[0].MetadataScanned || next.Books[0].Author != "" {
		t.Fatalf("changed PDF did not invalidate metadata: %+v", next)
	}
}
