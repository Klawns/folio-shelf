package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	maxCoverSize = 256 << 10
	coverVersion = 2
	coverPixels  = "480"
)

type limitedOutput struct {
	bytes.Buffer
	limit int
}

func (o *limitedOutput) Write(data []byte) (int, error) {
	if len(data) > o.limit-o.Len() {
		return 0, errors.New("PDF tool output limit exceeded")
	}
	return o.Buffer.Write(data)
}

func pdfTool(file *os.File, executable string, outputLimit int, args ...string) ([]byte, error) {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, executable, append(args, "/proc/self/fd/3")...)
	cmd.ExtraFiles = []*os.File{file}
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	output := &limitedOutput{limit: outputLimit}
	cmd.Stdout = output
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func applyPDFInfo(entry *record, output []byte) {
	for _, line := range strings.Split(string(output), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.Join(strings.Fields(strings.ToValidUTF8(value, "")), " ")
		if value == "" || len(value) > 512 {
			continue
		}
		switch key {
		case "Title":
			entry.Title = value
		case "Author":
			entry.Author = value
		case "Pages":
			if pages, err := strconv.Atoi(value); err == nil && pages > 0 {
				entry.PageCount = pages
			}
		}
	}
}

func coverPath(directory, hash string) string {
	if len(hash) != 64 || strings.Trim(hash, "0123456789abcdef") != "" {
		return ""
	}
	return filepath.Join(directory, hash+".jpg")
}

func generatedCoverPath(directory, hash string, page int) string {
	if coverPath(directory, hash) == "" {
		return ""
	}
	return filepath.Join(directory, fmt.Sprintf("%s-v%d-p%d.jpg", hash, coverVersion, page))
}

func cacheCover(path string, jpeg []byte) error {
	if len(jpeg) < 4 || !bytes.HasPrefix(jpeg, []byte{0xff, 0xd8}) || !bytes.HasSuffix(jpeg, []byte{0xff, 0xd9}) {
		return errors.New("invalid JPEG cover")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".cover-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	_, err = temp.Write(jpeg)
	closeErr := temp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(temp.Name(), path)
}

// Catalog publication happens before enrichment. A single worker processes PDFs serially.
func (s *service) enrich(previous index, indexPath string, infoTool, coverTool string) index {
	if infoTool == "" {
		return previous
	}
	root, err := s.openRoot()
	if err != nil {
		return previous
	}
	defer root.Close()
	next := previous
	next.Books = append([]record(nil), previous.Books...)
	changed := 0
	commit := func() {
		if changed == 0 {
			return
		}
		next.Version = newID()
		if err := saveIndex(indexPath, next); err != nil {
			log.Print("could not persist PDF metadata")
			return
		}
		previous = next
		published := previous
		s.catalog.Store(&published)
		next.Books = append([]record(nil), previous.Books...)
		changed = 0
	}
	for i := range next.Books {
		entry := &next.Books[i]
		if entry.Availability != "available" || (entry.MetadataScanned && (coverTool == "" || entry.CoverVersion == coverVersion)) {
			continue
		}
		if s.enrichBook(root, entry, infoTool, coverTool) {
			changed++
			if changed == 8 {
				commit()
			}
		}
	}
	commit()
	return previous
}

func (s *service) enrichBook(root *os.Root, entry *record, infoTool, coverTool string) bool {
	file, err := s.openBookFile(root, *entry)
	if err != nil {
		return false
	}
	defer file.Close()
	if s.pdfWork != nil {
		s.pdfWork <- struct{}{}
		defer func() { <-s.pdfWork }()
	}
	if !entry.MetadataScanned {
		output, err := pdfTool(file, infoTool, 64<<10, "-enc", "UTF-8")
		if err == nil {
			applyPDFInfo(entry, output)
		}
		entry.MetadataScanned = true
	}
	if coverTool != "" && entry.CoverVersion != coverVersion {
		if path := generatedCoverPath(s.covers, entry.Hash, 1); path != "" && entry.PageCount > 0 {
			if _, err := os.Stat(path); os.IsNotExist(err) {
				_ = renderCover(file, coverTool, path, 1)
			}
			if _, err := os.Stat(path); err == nil {
				entry.HasGeneratedCover = true
				entry.CoverURL = strings.TrimSuffix(entry.ReadURL, "/file") + "/cover"
			}
		}
		entry.CoverVersion = coverVersion
	}
	return true
}

func (s *service) openBookFile(root *os.Root, entry record) (*os.File, error) {
	name := filepath.FromSlash(entry.Path)
	before, err := root.Lstat(name)
	if err != nil || !before.Mode().IsRegular() {
		return nil, os.ErrNotExist
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	stat, err := file.Stat()
	if err != nil || !os.SameFile(before, stat) || stat.Size() != entry.Size || !stat.ModTime().Equal(entry.Modified) {
		file.Close()
		return nil, errors.New("PDF no longer matches the catalog")
	}
	return file, nil
}

func renderCover(file *os.File, tool, path string, page int) error {
	target := strconv.Itoa(page)
	output, err := pdfTool(file, tool, maxCoverSize, "-f", target, "-l", target, "-scale-to", coverPixels, "-singlefile", "-jpeg")
	if err != nil {
		return err
	}
	return cacheCover(path, output)
}
