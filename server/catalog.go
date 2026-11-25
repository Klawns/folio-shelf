package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type book struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Author       string    `json:"author,omitempty"`
	PageCount    int       `json:"pageCount,omitempty"`
	CoverURL     string    `json:"coverUrl,omitempty"`
	Category     string    `json:"category"`
	Format       string    `json:"format"`
	Size         int64     `json:"sizeBytes"`
	Modified     time.Time `json:"lastModified"`
	ETag         string    `json:"etag"`
	Availability string    `json:"availability"`
	ReadURL      string    `json:"readUrl"`
}

type record struct {
	book
	Path              string `json:"path"`
	Hash              string `json:"hash,omitempty"`
	MetadataScanned   bool   `json:"metadataScanned,omitempty"`
	CoverVersion      int    `json:"coverVersion,omitempty"`
	HasSidecar        bool   `json:"hasSidecar,omitempty"`
	HasGeneratedCover bool   `json:"hasGeneratedCover,omitempty"`
}

type index struct {
	Schema  int      `json:"schema"`
	Version string   `json:"version"`
	Books   []record `json:"books"`
}

func newID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func loadIndex(name string) (index, error) {
	data, err := os.ReadFile(name)
	if os.IsNotExist(err) {
		return index{Schema: 1, Version: newID(), Books: []record{}}, nil
	}
	if err != nil {
		return index{}, err
	}
	var result index
	if err := json.Unmarshal(data, &result); err != nil {
		return index{}, err
	}
	if result.Schema != 1 || result.Version == "" {
		return index{}, fmt.Errorf("unsupported index")
	}
	return result, nil
}

func saveIndex(name string, next index) error {
	if err := os.MkdirAll(filepath.Dir(name), 0750); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(name), ".catalog-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	err = json.NewEncoder(temp).Encode(next)
	if err == nil {
		err = temp.Sync()
	}
	closeErr := temp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(temp.Name(), name)
}

func hashFile(root *os.Root, name string, expected fs.FileInfo) (string, error) {
	file, err := root.Open(name)
	if err != nil {
		return "", err
	}
	defer file.Close()
	before, err := file.Stat()
	if err != nil {
		return "", err
	}
	if !before.Mode().IsRegular() || !os.SameFile(before, expected) {
		return "", fmt.Errorf("file changed")
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	after, err := file.Stat()
	if err != nil {
		return "", err
	}
	if after.Size() != expected.Size() || !after.ModTime().Equal(expected.ModTime()) {
		return "", fmt.Errorf("file changed")
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

func scan(root *os.Root, previous index, origin string) (index, error) {
	byPath := make(map[string]record)
	for _, old := range previous.Books {
		byPath[old.Path] = old
	}
	found := make(map[string]record)
	err := fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !entry.Type().IsRegular() || !strings.EqualFold(path.Ext(name), ".pdf") {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		old := byPath[name]
		hash := old.Hash
		if hash == "" || old.Size != info.Size() || !old.Modified.Equal(info.ModTime()) {
			hash, err = hashFile(root, filepath.FromSlash(name), info)
			if err != nil {
				return err
			}
		}
		category := path.Base(path.Dir(name))
		if category == "." {
			category = "Sem categoria"
		}
		found[name] = record{Path: name, Hash: hash, book: book{
			ID: old.ID, Title: strings.TrimSuffix(path.Base(name), path.Ext(name)), Category: category,
			Format: "pdf", Size: info.Size(), Modified: info.ModTime().UTC(), ETag: fmt.Sprintf("%q", hash), Availability: "available",
		}}
		return nil
	})
	if err != nil {
		return previous, err
	}
	missing := map[string][]record{}
	newCount := map[string]int{}
	for _, old := range previous.Books {
		if _, ok := found[old.Path]; !ok {
			missing[old.Hash] = append(missing[old.Hash], old)
		}
	}
	for _, current := range found {
		if current.ID == "" {
			newCount[current.Hash]++
		}
	}
	moved := map[string]bool{}
	next := index{Schema: 1, Version: previous.Version, Books: make([]record, 0, len(found))}
	for _, current := range found {
		old := byPath[current.Path]
		if current.ID == "" {
			matches := missing[current.Hash]
			if len(matches) == 1 && newCount[current.Hash] == 1 {
				current.ID = matches[0].ID
				old = matches[0]
				moved[current.ID] = true
			} else {
				current.ID = newID()
			}
		}
		current.ReadURL = origin + "/api/v1/books/" + current.ID + "/file"
		current.HasSidecar = existingCoverSidecar(root, current.Path)
		if old.Hash == current.Hash && old.MetadataScanned {
			current.MetadataScanned = true
			current.CoverVersion = old.CoverVersion
			if old.Title != strings.TrimSuffix(path.Base(old.Path), path.Ext(old.Path)) {
				current.Title = old.Title
			}
			current.Author, current.PageCount = old.Author, old.PageCount
			current.HasGeneratedCover = old.HasGeneratedCover || (old.CoverURL != "" && !old.HasSidecar)
		}
		if current.HasSidecar || current.HasGeneratedCover {
			current.CoverURL = strings.TrimSuffix(current.ReadURL, "/file") + "/cover"
		}
		next.Books = append(next.Books, current)
	}
	for _, group := range missing {
		for _, old := range group {
			if moved[old.ID] {
				continue
			}
			old.Availability = "missing"
			old.ReadURL = origin + "/api/v1/books/" + old.ID + "/file"
			if old.CoverURL != "" {
				old.CoverURL = strings.TrimSuffix(old.ReadURL, "/file") + "/cover"
			}
			next.Books = append(next.Books, old)
		}
	}
	sort.Slice(next.Books, func(i, j int) bool { return next.Books[i].ID < next.Books[j].ID })
	if len(next.Books) == len(previous.Books) {
		unchanged := true
		for i, current := range next.Books {
			if current != previous.Books[i] {
				unchanged = false
				break
			}
		}
		if unchanged {
			return previous, nil
		}
	}
	next.Version = newID()
	return next, nil
}
