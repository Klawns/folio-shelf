package main

import (
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const maxSidecarSize = 5 << 20

func coverSidecars(path string) []string {
	stem := strings.TrimSuffix(path, filepath.Ext(path))
	return []string{stem + ".cover.jpg", stem + ".cover.png"}
}

func existingCoverSidecar(root *os.Root, path string) bool {
	for _, name := range coverSidecars(path) {
		info, err := root.Lstat(filepath.FromSlash(name))
		if err == nil && info.Mode().IsRegular() && info.Size() <= maxSidecarSize {
			return true
		}
	}
	return false
}

func serveSidecar(w http.ResponseWriter, r *http.Request, root *os.Root, entry record) bool {
	for _, candidate := range coverSidecars(entry.Path) {
		if serveSidecarFile(w, r, root, filepath.FromSlash(candidate)) {
			return true
		}
	}
	return false
}

func serveSidecarFile(w http.ResponseWriter, r *http.Request, root *os.Root, name string) bool {
	before, err := root.Lstat(name)
	if err != nil || !before.Mode().IsRegular() || before.Size() > maxSidecarSize {
		return false
	}
	file, err := root.Open(name)
	if err != nil {
		return false
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !os.SameFile(before, info) || info.Size() > maxSidecarSize {
		return false
	}
	config, kind, err := image.DecodeConfig(io.LimitReader(file, maxSidecarSize))
	if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 4000 || config.Height > 4000 {
		return false
	}
	w.Header().Set("Content-Type", "image/"+kind)
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	w.Header().Set("ETag", fmt.Sprintf("\"sidecar-%s-%x-%x\"", kind, info.ModTime().UnixNano(), info.Size()))
	http.ServeContent(w, r, "cover."+kind, info.ModTime(), file)
	return true
}

func (s *service) serveCover(w http.ResponseWriter, r *http.Request, entry record) {
	page := 1
	if raw := r.URL.Query().Get("page"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || (parsed > 1 && parsed > entry.PageCount) {
			http.Error(w, "Invalid cover page", http.StatusBadRequest)
			return
		}
		page = parsed
	}
	if entry.Availability == "available" && entry.HasSidecar {
		if root, err := s.openRoot(); err == nil {
			defer root.Close()
			if serveSidecar(w, r, root, entry) {
				return
			}
		}
	}
	path := generatedCoverPath(s.covers, entry.Hash, page)
	if serveCachedCover(w, r, path) {
		return
	}
	if page == 1 {
		if !serveCachedCover(w, r, coverPath(s.covers, entry.Hash)) {
			http.NotFound(w, r)
		}
		return
	}
	if s.coverTool == "" || entry.Availability != "available" || path == "" {
		http.NotFound(w, r)
		return
	}
	select {
	case s.pdfWork <- struct{}{}:
		defer func() { <-s.pdfWork }()
	default:
		http.Error(w, "Cover generation busy", http.StatusServiceUnavailable)
		return
	}
	if !serveCachedCover(w, r, path) && (!s.renderSelectedCover(entry, page, path) || !serveCachedCover(w, r, path)) {
		http.NotFound(w, r)
	}
}

func (s *service) renderSelectedCover(entry record, page int, path string) bool {
	root, err := s.openRoot()
	if err != nil {
		return false
	}
	defer root.Close()
	file, err := s.openBookFile(root, entry)
	if err != nil {
		return false
	}
	defer file.Close()
	if err := renderCover(file, s.coverTool, path, page); err != nil {
		return false
	}
	// Keep one alternative per PDF. Previous links still work by regenerating the page.
	candidates, _ := filepath.Glob(filepath.Join(s.covers, entry.Hash+"-v"+strconv.Itoa(coverVersion)+"-p*.jpg"))
	main := generatedCoverPath(s.covers, entry.Hash, 1)
	for _, old := range candidates {
		if old != main && old != path {
			_ = os.Remove(old)
		}
	}
	return true
}

func serveCachedCover(w http.ResponseWriter, r *http.Request, path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() || stat.Size() > maxCoverSize {
		return false
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	w.Header().Set("ETag", fmt.Sprintf("\"%s-%x\"", filepath.Base(path), stat.ModTime().UnixNano()))
	http.ServeContent(w, r, "cover.jpg", stat.ModTime(), file)
	return true
}
