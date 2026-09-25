package main

// JS-faithful serialization helpers.
// The Node server emits JSON.stringify(obj, null, 2). Go's encoding/json
// differs in three ways that matter for byte parity:
//   - MarshalIndent HTML-escapes <, >, & (JSON.stringify does not)
//   - string lengths for token estimates are UTF-16 code units, not bytes
//   - undefined fields are omitted; null emits literally

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"
)

// stringify mirrors JSON.stringify(v, null, 2): 2-space indent, no HTML
// escaping, no trailing newline.
func stringify(v any) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	return strings.TrimSuffix(buf.String(), "\n"), nil
}

// jsLen is JS String.length: UTF-16 code units, not bytes.
func jsLen(s string) int {
	return len(utf16.Encode([]rune(s)))
}

// isoNow mirrors new Date().toISOString(): UTC, millisecond precision, Z suffix.
func isoNow(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

var (
	reHoursAgo = regexp.MustCompile(`^(\d+) hours? ago$`)
	reDaysAgo  = regexp.MustCompile(`^(\d+) days? ago$`)
)

// parseRelativeTime mirrors ContextRepository.parseRelativeTime:
// returns an ISO timestamp string or "" for unrecognized input.
func parseRelativeTime(rt string, now time.Time) string {
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, now.Location())
	switch {
	case rt == "today":
		return isoNow(today)
	case rt == "yesterday":
		return isoNow(today.Add(-24 * time.Hour))
	}
	if mm := reHoursAgo.FindStringSubmatch(rt); mm != nil {
		var h int
		fmtSscanf(mm[1], &h)
		return isoNow(now.Add(-time.Duration(h) * time.Hour))
	}
	if mm := reDaysAgo.FindStringSubmatch(rt); mm != nil {
		var days int
		fmtSscanf(mm[1], &days)
		return isoNow(now.Add(-time.Duration(days) * 24 * time.Hour))
	}
	if rt == "this week" {
		return isoNow(today.AddDate(0, 0, -int(today.Weekday())))
	}
	if rt == "last week" {
		return isoNow(today.AddDate(0, 0, -int(today.Weekday())-7))
	}
	return ""
}

// createdBeforeEffective mirrors the handler's special-casing: 'today' and
// 'yesterday' resolve to the START of that day; other relative strings go
// through parseRelativeTime; anything else passes through verbatim.
func createdBeforeEffective(cb string, now time.Time) string {
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, now.Location())
	switch cb {
	case "today":
		return isoNow(today)
	case "yesterday":
		return isoNow(today.Add(-24 * time.Hour))
	}
	if p := parseRelativeTime(cb, now); p != "" {
		return p
	}
	return cb
}

func createdAfterEffective(ca string, now time.Time) string {
	if p := parseRelativeTime(ca, now); p != "" {
		return p
	}
	return ca
}

// fmtSscanf is a tiny atoi wrapper to keep regex branches tidy.
func fmtSscanf(s string, out *int) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int(c-'0')
	}
	*out = n
}

func floorf(f float64) int { return int(math.Floor(f)) }
func ceilf(f float64) int  { return int(math.Ceil(f)) }
