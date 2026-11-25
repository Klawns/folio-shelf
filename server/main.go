package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

type service struct {
	catalog   atomic.Pointer[index]
	root      string
	marker    string
	reads     chan struct{}
	ready     atomic.Bool
	covers    string
	coverTool string
	pdfWork   chan struct{}
}

func (s *service) openRoot() (*os.Root, error) {
	root, err := os.OpenRoot(s.root)
	if err != nil {
		return nil, err
	}
	marker, err := root.Stat(s.marker)
	if err != nil || !marker.Mode().IsRegular() {
		root.Close()
		return nil, os.ErrNotExist
	}
	return root, nil
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(value)
}

func (s *service) routes(corsOrigins string) http.Handler {
	allowedOrigins := make(map[string]bool)
	for _, origin := range strings.Split(corsOrigins, ",") {
		if origin = strings.TrimSpace(origin); origin != "" && origin != "*" {
			allowedOrigins[origin] = true
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		health := map[string]any{"version": "0.2.1", "catalogReady": s.ready.Load()}
		if current := s.catalog.Load(); current != nil {
			health["catalogVersion"] = current.Version
		}
		writeJSON(w, health)
	})
	mux.HandleFunc("GET /api/v1/books", s.listBooks)
	mux.HandleFunc("GET /api/v1/books/{id}", s.getBook)
	mux.HandleFunc("GET /api/v1/books/{id}/file", s.getBook)
	mux.HandleFunc("GET /api/v1/books/{id}/cover", s.getBook)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Add("Vary", "Origin")
		if origin := r.Header.Get("Origin"); allowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length, ETag")
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD")
				w.Header().Set("Access-Control-Allow-Headers", "Range, If-Range")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *service) listBooks(w http.ResponseWriter, r *http.Request) {
	current := s.catalog.Load()
	if current == nil {
		http.Error(w, "Catalog unavailable", http.StatusServiceUnavailable)
		return
	}
	q := r.URL.Query()
	offset := 0
	if cursor := q.Get("cursor"); cursor != "" {
		version, rawOffset, ok := strings.Cut(cursor, ":")
		if !ok || version != current.Version {
			http.Error(w, "Catalog changed", http.StatusConflict)
			return
		}
		var err error
		offset, err = strconv.Atoi(rawOffset)
		if err != nil || offset < 0 || offset > len(current.Books) {
			http.Error(w, "Invalid cursor", http.StatusBadRequest)
			return
		}
	}
	books := make([]book, 0, 100)
	search, category := strings.ToLower(q.Get("q")), q.Get("category")
	next := ""
	for i := offset; i < len(current.Books); i++ {
		entry := current.Books[i]
		if !strings.Contains(strings.ToLower(entry.Title+" "+entry.Author), search) || (category != "" && entry.Category != category) {
			continue
		}
		if len(books) == 100 {
			next = current.Version + ":" + strconv.Itoa(i)
			break
		}
		books = append(books, entry.book)
	}
	writeJSON(w, map[string]any{"version": current.Version, "books": books, "nextCursor": next})
}

func (s *service) getBook(w http.ResponseWriter, r *http.Request) {
	current := s.catalog.Load()
	if current == nil {
		http.Error(w, "Catalog unavailable", http.StatusServiceUnavailable)
		return
	}
	for _, entry := range current.Books {
		if entry.ID != r.PathValue("id") {
			continue
		}
		if strings.HasSuffix(r.URL.Path, "/cover") {
			s.serveCover(w, r, entry)
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/file") {
			writeJSON(w, entry.book)
			return
		}
		if entry.Availability != "available" {
			break
		}
		s.serveFile(w, r, entry)
		return
	}
	http.NotFound(w, r)
}

func (s *service) serveFile(w http.ResponseWriter, r *http.Request, entry record) {
	select {
	case s.reads <- struct{}{}:
		defer func() { <-s.reads }()
	default:
		http.Error(w, "Server busy", http.StatusServiceUnavailable)
		return
	}
	root, err := s.openRoot()
	if err != nil {
		http.Error(w, "Library unavailable", http.StatusServiceUnavailable)
		return
	}
	defer root.Close()
	name := filepath.FromSlash(entry.Path)
	before, err := root.Lstat(name)
	if err != nil || !before.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	file, err := root.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !os.SameFile(before, info) || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	if info.Size() != entry.Size || !info.ModTime().Equal(entry.Modified) {
		http.Error(w, "Catalog update required", http.StatusServiceUnavailable)
		return
	}
	var signature [1024]byte
	n, _ := file.ReadAt(signature[:], 0)
	if !bytes.Contains(signature[:n], []byte("%PDF-")) {
		http.Error(w, "Invalid PDF", http.StatusUnsupportedMediaType)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	w.Header().Set("ETag", entry.ETag)
	http.ServeContent(w, r, "book.pdf", info.ModTime(), file)
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func main() {
	origin, err := url.Parse(os.Getenv("LIBRARY_PUBLIC_URL"))
	if err != nil || origin.Scheme != "https" || origin.Hostname() == "" || origin.User != nil ||
		origin.RawQuery != "" || origin.ForceQuery || origin.Fragment != "" || (origin.Path != "" && origin.Path != "/") {
		log.Fatal("LIBRARY_PUBLIC_URL must be an HTTPS origin")
	}
	origin.Path, origin.RawPath = "", ""
	origin.Host = strings.ToLower(strings.TrimSuffix(origin.Host, ":443"))
	publicURL := origin.String()
	if len(publicURL)+len("/api/v1/books//file")+36 > 300 {
		log.Fatal("LIBRARY_PUBLIC_URL is too long for PDF++ references")
	}
	address := env("LIBRARY_LISTEN", "127.0.0.1:8091")
	host, _, err := net.SplitHostPort(address)
	if ip := net.ParseIP(host); err != nil || ip == nil || !ip.IsLoopback() {
		log.Fatal("LIBRARY_LISTEN must be loopback")
	}
	interval, err := time.ParseDuration(env("LIBRARY_SCAN_INTERVAL", "15m"))
	if err != nil || interval < time.Minute {
		log.Fatal("LIBRARY_SCAN_INTERVAL must be at least one minute")
	}
	s := &service{root: env("LIBRARY_ROOT", "/srv/biblioteca/livros"), marker: ".obsidian-library", reads: make(chan struct{}, 4)}
	indexPath := env("LIBRARY_INDEX", "/var/lib/obsidian-library/catalog.json")
	s.covers = filepath.Join(filepath.Dir(indexPath), "covers")
	infoTool, _ := exec.LookPath("pdfinfo")
	var coverTool string
	if env("LIBRARY_GENERATE_COVERS", "true") == "true" {
		coverTool, _ = exec.LookPath("pdftoppm")
	}
	s.coverTool = coverTool
	s.pdfWork = make(chan struct{}, 1)
	previous, err := loadIndex(indexPath)
	if err != nil {
		log.Fatal("could not load catalog index")
	}
	if _, err := os.Stat(indexPath); err == nil {
		s.catalog.Store(&previous)
		s.ready.Store(true)
	}
	go func() {
		tick := time.NewTicker(interval)
		defer tick.Stop()
		for {
			root, err := s.openRoot()
			if err == nil {
				var next index
				next, err = scan(root, previous, publicURL)
				if err == nil {
					// Reopen the configured path before committing in case the drive disappeared.
					var mounted *os.Root
					mounted, err = s.openRoot()
					if err == nil {
						before, beforeErr := root.Stat(".")
						after, afterErr := mounted.Stat(".")
						mounted.Close()
						if beforeErr != nil || afterErr != nil || !os.SameFile(before, after) {
							err = os.ErrNotExist
						}
					}
				}
				root.Close()
				if err == nil && (next.Version != previous.Version || s.catalog.Load() == nil) {
					err = saveIndex(indexPath, next)
				}
				if err == nil {
					previous = next
					s.catalog.Store(&next)
					s.ready.Store(true)
					previous = s.enrich(previous, indexPath, infoTool, coverTool)
				}
			}
			if err != nil {
				s.ready.Store(false)
				log.Print("catalog scan failed; previous catalog retained")
			}
			<-tick.C
		}
	}()
	server := &http.Server{Addr: address, Handler: s.routes(os.Getenv("LIBRARY_PDF_ORIGIN")), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	log.Fatal(server.ListenAndServe())
}
