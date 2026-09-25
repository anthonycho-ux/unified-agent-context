package main

// Tool handlers — byte-faithful ports of the index.js cases for
// context_session_start / context_save / context_get / context_search.

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
)

// ---------- arg helpers (JS truthiness / Number.isInteger semantics) ----------

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0
	}
	return true
}

func argStr(args map[string]any, k string) string {
	if v, ok := args[k]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func argBool(args map[string]any, k string) bool { return truthy(args[k]) }

// argNum returns (float64, present). JSON numbers decode as float64.
func argNum(args map[string]any, k string) (float64, bool) {
	v, ok := args[k]
	if !ok || v == nil {
		return 0, false
	}
	f, ok := v.(float64)
	return f, ok
}

func argStrSlice(args map[string]any, k string) []string {
	v, ok := args[k]
	if !ok {
		return nil
	}
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// jsSubstr mirrors String.prototype.substring on UTF-16 code units.
func jsSubstr(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

func isInteger(f float64) bool { return f == float64(int64(f)) }

// ---------- responses ----------

// metaPagination mirrors the includeMetadata pagination object, key order intact.
type metaPagination struct {
	Total           int64        `json:"total"`
	Returned        int          `json:"returned"`
	Offset          int64        `json:"offset"`
	HasMore         bool         `json:"hasMore"`
	NextOffset      *int64       `json:"nextOffset"`
	TotalCount      int64        `json:"totalCount"`
	Page            int64        `json:"page"`
	PageSize        int64        `json:"pageSize"`
	TotalPages      int64        `json:"totalPages"`
	HasNextPage     bool         `json:"hasNextPage"`
	HasPreviousPage bool         `json:"hasPreviousPage"`
	PreviousOffset  *int64       `json:"previousOffset"`
	TotalSize       int          `json:"totalSize"`
	AverageSize     int          `json:"averageSize"`
	DefaultsApplied defaultsUsed `json:"defaultsApplied"`
	Truncated       bool         `json:"truncated"`
	TruncatedCount  int          `json:"truncatedCount"`
	Warning         string       `json:"warning,omitempty"`
	TokenInfo       *tokenInfo   `json:"tokenInfo,omitempty"`
}

type defaultsUsed struct {
	Limit bool `json:"limit"`
	Sort  bool `json:"sort"`
}

type tokenInfo struct {
	EstimatedTokens int   `json:"estimatedTokens"`
	MaxAllowed      int   `json:"maxAllowed"`
	SafeLimit       int64 `json:"safeLimit"`
}

type plainPagination struct {
	Total          int64   `json:"total"`
	Returned       int     `json:"returned"`
	Offset         int64   `json:"offset"`
	HasMore        bool    `json:"hasMore"`
	NextOffset     *int64  `json:"nextOffset"`
	Truncated      bool    `json:"truncated"`
	TruncatedCount int     `json:"truncatedCount"`
	Warning        string  `json:"warning,omitempty"`
}

// ---------- handlers ----------

func (s *Store) handleSessionStart(args map[string]any) (string, bool) {
	name := argStr(args, "name")
	description := argStr(args, "description")
	continueFrom := argStr(args, "continueFrom")
	projectDir := argStr(args, "projectDir")
	defaultChannel := argStr(args, "defaultChannel")

	checkPath := projectDir
	if checkPath == "" {
		cwd, _ := os.Getwd()
		checkPath = cwd
	}
	branch, gitDetected := detectBranch(checkPath)

	channel := defaultChannel
	if channel == "" {
		channel = deriveDefaultChannel(branch, name)
	}

	sess, err := s.createSession(sessionInput{
		Name:           name,
		Description:    description,
		Branch:         branch,
		WorkingDir:     projectDir,
		DefaultChannel: channel,
	})
	if err != nil {
		return fmt.Sprintf("Failed to create session: %s", err.Error()), false
	}

	if continueFrom != "" {
		s.copyBetweenSessions(continueFrom, sess.ID)
	}
	s.currentSessionID = sess.ID
	s.hasCurrent = true

	displayName := name
	if displayName == "" {
		displayName = "Unnamed"
	}
	msg := fmt.Sprintf("Started new session: %s\nName: %s\nChannel: %s", sess.ID, displayName, channel)

	if projectDir != "" {
		msg += fmt.Sprintf("\nProject directory: %s", projectDir)
		if gitDetected {
			b := branch
			if b == "" {
				b = "unknown"
			}
			msg += fmt.Sprintf("\nGit branch: %s", b)
		} else {
			msg += "\nGit: No repository found in project directory"
		}
	} else {
		b := branch
		if b == "" {
			b = "unknown"
		}
		msg += fmt.Sprintf("\nGit branch: %s", b)
		cwd, _ := os.Getwd()
		cwdHasGit := fileExists(filepath.Join(cwd, ".git"))
		sessName := name
		if sessName == "" {
			sessName = "My Session"
		}
		if cwdHasGit {
			msg += fmt.Sprintf("\n\n💡 Tip: Your current directory has a git repository. To enable full git tracking, start a session with:\ncontext_session_start({ name: \"%s\", projectDir: \"%s\" })", sessName, cwd)
		} else {
			var gitSubdirs []string
			if entries, err := os.ReadDir(cwd); err == nil {
				for _, e := range entries {
					if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
						continue
					}
					if fileExists(filepath.Join(cwd, e.Name(), ".git")) {
						gitSubdirs = append(gitSubdirs, e.Name())
					}
				}
			}
			if len(gitSubdirs) > 0 {
				msg += fmt.Sprintf("\n\n💡 Found git repositories in: %s", strings.Join(gitSubdirs, ", "))
				msg += "\nTo enable git tracking, start a session with your project directory:"
				msg += fmt.Sprintf("\ncontext_session_start({ name: \"%s\", projectDir: \"%s\" })", sessName, filepath.Join(cwd, gitSubdirs[0]))
			} else {
				msg += "\n\n💡 To enable git tracking, start a session with your project directory:"
				msg += fmt.Sprintf("\ncontext_session_start({ name: \"%s\", projectDir: \"/path/to/your/project\" })", sessName)
			}
		}
	}
	return msg, false
}

func (s *Store) handleSave(args map[string]any) (string, bool) {
	key := args["key"]
	value := argStr(args, "value")
	category := argStr(args, "category")
	priority := argStr(args, "priority")
	if priority == "" {
		priority = "normal"
	}
	isPrivate := argBool(args, "private")
	channel := argStr(args, "channel")
	keyStr, _ := key.(string)

	sessionID, err := s.ensureSession()
	if err != nil {
		return fmt.Sprintf("Failed to save context item: %s", err.Error()), false
	}

	in := saveInput{Key: key, Value: value, Category: category, Priority: priority, IsPrivate: isPrivate, Channel: channel}

	sess, serr := s.sessionByID(sessionID)
	if serr == nil && sess == nil {
		// Session deleted/corrupted — recovery path
		ns, rerr := s.createSession(sessionInput{Name: "Recovery Session", Description: "Auto-created after session corruption"})
		if rerr != nil {
			return fmt.Sprintf("Failed to save context item: %s", rerr.Error()), false
		}
		s.currentSessionID = ns.ID
		s.hasCurrent = true
		it, serr2 := s.save(ns.ID, in)
		if serr2 != nil {
			return fmt.Sprintf("Failed to save context item: %s", serr2.Error()), false
		}
		_ = it
		cat := category
		if cat == "" {
			cat = "none"
		}
		return fmt.Sprintf("Saved: %s\nCategory: %s\nPriority: %s\nSession: %s (recovered)", keyStr, cat, priority, shortID(ns.ID)), false
	}

	item, err := s.save(sessionID, in)
	if err != nil {
		// FK recovery path mirrors index.js
		if strings.Contains(err.Error(), "FOREIGN KEY constraint failed") {
			ns, rerr := s.createSession(sessionInput{Name: "Emergency Recovery Session", Description: "Created due to foreign key constraint failure"})
			if rerr != nil {
				return fmt.Sprintf("Failed to save context item: %s", rerr.Error()), false
			}
			s.currentSessionID = ns.ID
			s.hasCurrent = true
			if _, serr2 := s.save(ns.ID, in); serr2 != nil {
				return fmt.Sprintf("Failed to save context item: %s", serr2.Error()), false
			}
			cat := category
			if cat == "" {
				cat = "none"
			}
			return fmt.Sprintf("Saved: %s\nCategory: %s\nPriority: %s\nSession: %s (emergency recovery)", keyStr, cat, priority, shortID(ns.ID)), false
		}
		return fmt.Sprintf("Failed to save context item: %s", err.Error()), false
	}

	cat := category
	if cat == "" {
		cat = "none"
	}
	ch := "general"
	if item.Channel != nil && *item.Channel != "" {
		ch = *item.Channel
	}
	return fmt.Sprintf("Saved: %s\nCategory: %s\nPriority: %s\nChannel: %s\nSession: %s", keyStr, cat, priority, ch, shortID(sessionID)), false
}

func (s *Store) handleGet(args map[string]any) (string, bool) {
	target := argStr(args, "sessionId")
	if target == "" {
		if s.hasCurrent {
			target = s.currentSessionID
		} else {
			var err error
			target, err = s.ensureSession()
			if err != nil {
				return fmt.Sprintf("Failed to get context: %s", err.Error()), false
			}
		}
	}
	includeMetadata := argBool(args, "includeMetadata")

	rawLimit, hasLimit := argNum(args, "limit")
	rawOffset, hasOffset := argNum(args, "offset")

	// JS: params.limit = rawLimit !== undefined ? rawLimit : dynamicDefault
	defaultLimit := s.dynamicDefaultLimit(target, includeMetadata)
	var candidate float64
	limitProvided := false
	if hasLimit {
		candidate = rawLimit
		limitProvided = true
	} else {
		candidate = float64(defaultLimit)
	}

	// validatePaginationParams: defaults limit=25, offset=0
	var limit int64 = 25
	var offset int64
	if limitProvided {
		if !isInteger(candidate) || candidate <= 0 {
			// invalid → stays 25
		} else {
			limit = int64(candidate)
			if limit > 100 {
				limit = 100
			}
			if limit < 1 {
				limit = 1
			}
		}
	} else {
		// params.limit was the dynamic default — always a valid positive int
		limit = int64(candidate)
		if limit > 100 {
			limit = 100
		}
	}
	if hasOffset {
		if !isInteger(rawOffset) || rawOffset < 0 {
			// invalid → stays 0
		} else {
			offset = int64(rawOffset)
		}
	}

	items, total, err := s.filteredQuery(queryOpts{
		sessionID:     target,
		key:           argStr(args, "key"),
		category:      argStr(args, "category"),
		channel:       argStr(args, "channel"),
		channels:      argStrSlice(args, "channels"),
		sort:          argStr(args, "sort"),
		limit:         qeLimit(&limit),
		offset:        offset,
		createdAfter:  argStr(args, "createdAfter"),
		createdBefore: argStr(args, "createdBefore"),
		keyPattern:    argStr(args, "keyPattern"),
		priorities:    argStrSlice(args, "priorities"),
	}, false)
	if err != nil {
		return fmt.Sprintf("Failed to get context: %s", err.Error()), false
	}
	if len(items) == 0 {
		return "No matching context found", false
	}

	tokenConfig := getTokenConfig()
	exceeds, estTokens, safeItemCount := checkTokenLimit(items, includeMetadata, tokenConfig)
	actual := items
	wasTruncated := false
	truncatedCount := 0
	if exceeds && safeItemCount < len(items) {
		actual = items[:safeItemCount]
		wasTruncated = true
		truncatedCount = len(items) - safeItemCount
	}

	// metrics
	totalSize := 0
	for _, it := range actual {
		if it.Size != nil && *it.Size != 0 {
			totalSize += int(*it.Size)
		} else if it.Value != nil {
			totalSize += calculateSize(*it.Value)
		}
	}
	avgSize := 0
	if len(actual) > 0 {
		avgSize = int(float64(totalSize)/float64(len(actual)) + 0.5)
	}

	var currentPage, totalPages int64 = 1, 1
	if limit > 0 {
		currentPage = offset/limit + 1
		totalPages = (total + limit - 1) / limit
	}
	hasNext := wasTruncated || currentPage < totalPages
	hasPrev := currentPage > 1
	var nextOffset *int64
	if hasNext {
		var n int64
		if wasTruncated {
			n = offset + int64(len(actual))
		} else {
			n = offset + limit
		}
		nextOffset = &n
	}
	var prevOffset *int64
	if hasPrev {
		p := offset - limit
		if p < 0 {
			p = 0
		}
		prevOffset = &p
	}

	defaults := defaultsUsed{Limit: !hasLimit, Sort: args["sort"] == nil}

	if includeMetadata {
		metas := make([]metaItem, len(actual))
		for i, it := range actual {
			metas[i] = toMetaItem(it)
		}
		resp := struct {
			Items      []metaItem     `json:"items"`
			Pagination metaPagination `json:"pagination"`
		}{
			Items: metas,
			Pagination: metaPagination{
				Total: total, Returned: len(actual), Offset: offset, HasMore: hasNext,
				NextOffset: nextOffset, TotalCount: total, Page: currentPage,
				PageSize: limit, TotalPages: totalPages, HasNextPage: hasNext,
				HasPreviousPage: hasPrev, PreviousOffset: prevOffset,
				TotalSize: totalSize, AverageSize: avgSize,
				DefaultsApplied: defaults, Truncated: wasTruncated, TruncatedCount: truncatedCount,
			},
		}
		if wasTruncated {
			resp.Pagination.Warning = fmt.Sprintf("Response truncated to prevent token overflow (estimated %d tokens). %d items omitted. Use pagination with offset=%d to retrieve remaining items.", estTokens, truncatedCount, *nextOffset)
			resp.Pagination.TokenInfo = &tokenInfo{EstimatedTokens: estTokens, MaxAllowed: tokenConfig.mcpMaxTokens, SafeLimit: int64(float64(tokenConfig.mcpMaxTokens) * tokenConfig.safetyBuffer)}
		} else if float64(estTokens) > float64(tokenConfig.mcpMaxTokens)*0.7 {
			resp.Pagination.Warning = "Large result set approaching token limits. Consider using smaller limit or more specific filters."
		}
		js, _ := stringify(resp)
		return js, false
	}

	resp := struct {
		Items      []*rawItem      `json:"items"`
		Pagination plainPagination `json:"pagination"`
	}{
		Items: actual,
		Pagination: plainPagination{
			Total: total, Returned: len(actual), Offset: offset, HasMore: hasNext,
			NextOffset: nextOffset, Truncated: wasTruncated, TruncatedCount: truncatedCount,
		},
	}
	if wasTruncated {
		resp.Pagination.Warning = fmt.Sprintf("Response truncated to prevent token overflow. %d items omitted. Use pagination with offset=%d to retrieve remaining items.", truncatedCount, *nextOffset)
	} else if float64(estTokens) > float64(tokenConfig.mcpMaxTokens)*0.7 {
		resp.Pagination.Warning = "Large result set approaching token limits. Consider using smaller limit or more specific filters."
	}
	js, _ := stringify(resp)
	return js, false
}

func (s *Store) handleSearch(args map[string]any) (string, bool) {
	target := argStr(args, "sessionId")
	if target == "" {
		if s.hasCurrent {
			target = s.currentSessionID
		} else {
			var err error
			target, err = s.ensureSession()
			if err != nil {
				return fmt.Sprintf("Failed to search context: %s", err.Error()), false
			}
		}
	}
	query := argStr(args, "query")
	searchIn := argStrSlice(args, "searchIn")
	includeMetadata := argBool(args, "includeMetadata")

	// searchEnhanced: no pagination validation — limit truthy → LIMIT, offset>0 → OFFSET.
	var limit *int64
	if f, ok := argNum(args, "limit"); ok && f != 0 {
		l := int64(f)
		limit = &l
	}
	var offset int64
	if f, ok := argNum(args, "offset"); ok && f > 0 {
		offset = int64(f)
	}

	items, total, err := s.filteredQuery(queryOpts{
		sessionID:     target,
		category:      argStr(args, "category"),
		channel:       argStr(args, "channel"),
		channels:      argStrSlice(args, "channels"),
		sort:          argStr(args, "sort"),
		limit:         limit,
		offset:        offset,
		createdAfter:  argStr(args, "createdAfter"),
		createdBefore: argStr(args, "createdBefore"),
		keyPattern:    argStr(args, "keyPattern"),
		priorities:    argStrSlice(args, "priorities"),
		query:         query,
		searchIn:      searchIn,
		hasQuery:      args["query"] != nil,
	}, true)
	if err != nil {
		return fmt.Sprintf("Failed to search context: %s", err.Error()), false
	}
	if len(items) == 0 {
		return fmt.Sprintf("No results found for: \"%s\"", query), false
	}

	if includeMetadata {
		metas := make([]metaItem, len(items))
		for i, it := range items {
			metas[i] = toMetaItem(it)
		}
		var page int64 = 1
		var pageSize int64 = int64(len(items))
		if limit != nil {
			page = offset/(*limit) + 1
			pageSize = *limit
		} else if offset > 0 {
			// JS: offset && limit — limit undefined → page 1
		}
		resp := struct {
			Items      []metaItem `json:"items"`
			TotalCount int64      `json:"totalCount"`
			Page       int64      `json:"page"`
			PageSize   int64      `json:"pageSize"`
			Query      string     `json:"query"`
		}{Items: metas, TotalCount: total, Page: page, PageSize: pageSize, Query: query}
		js, _ := stringify(resp)
		return js, false
	}

	var lines []string
	for _, r := range items {
		pri := "normal"
		if r.Priority != nil {
			pri = *r.Priority
		}
		key := ""
		if r.Key != nil {
			key = *r.Key
		}
		cat := "none"
		if r.Category != nil && *r.Category != "" {
			cat = *r.Category
		}
		val := ""
		if r.Value != nil {
			val = *r.Value
		}
		short := jsSubstr(val, 100)
		if jsLen(val) > 100 {
			short += "..."
		}
		lines = append(lines, fmt.Sprintf("• [%s] %s (%s)\n  %s", pri, key, cat, short))
	}
	return fmt.Sprintf("Found %d results for \"%s\":\n\n%s", len(items), query, strings.Join(lines, "\n\n")), false
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
