package main

// Store logic — a faithful port of mcp-memory-keeper's
// SessionRepository / ContextRepository / utils/{channels,validation,token-limits}
// covering exactly the four tools UAC calls:
//   context_session_start, context_save, context_get, context_search

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db               *sql.DB
	currentSessionID string
	hasCurrent       bool
	now              func() time.Time // test seam
}

func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	dbPath := filepath.Join(dataDir, "context.db")
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(schemaDDL); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, now: time.Now}, nil
}

// Tables/triggers used by the four implemented tools, matching
// mcp-memory-keeper's DDL verbatim so fresh databases behave identically.
const schemaDDL = `
CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        branch TEXT,
        working_directory TEXT,
        parent_id TEXT,
        default_channel TEXT DEFAULT 'general',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES sessions(id)
      );
CREATE TRIGGER IF NOT EXISTS update_sessions_timestamp
      AFTER UPDATE ON sessions
      BEGIN
        UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
CREATE TABLE IF NOT EXISTS context_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT,
        priority TEXT DEFAULT 'normal',
        metadata TEXT,
        size INTEGER DEFAULT 0,
        is_private INTEGER DEFAULT 0,
        channel TEXT DEFAULT 'general',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sequence_number INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, key)
      );
CREATE INDEX IF NOT EXISTS idx_context_items_session ON context_items(session_id);
CREATE INDEX IF NOT EXISTS idx_context_items_category ON context_items(category);
CREATE INDEX IF NOT EXISTS idx_context_items_priority ON context_items(priority);
CREATE INDEX IF NOT EXISTS idx_context_items_private ON context_items(is_private);
CREATE INDEX IF NOT EXISTS idx_context_items_channel ON context_items(channel);
CREATE INDEX IF NOT EXISTS idx_context_items_created ON context_items(created_at);
CREATE INDEX IF NOT EXISTS idx_context_items_session_created ON context_items(session_id, created_at);
CREATE TABLE IF NOT EXISTS context_changes (
              sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL,
              item_id TEXT NOT NULL,
              key TEXT NOT NULL,
              operation TEXT NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE')),
              old_value TEXT,
              new_value TEXT,
              old_metadata TEXT,
              new_metadata TEXT,
              category TEXT,
              priority TEXT,
              channel TEXT,
              size_delta INTEGER DEFAULT 0,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              created_by TEXT,
              FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
CREATE TRIGGER IF NOT EXISTS track_context_insert
            AFTER INSERT ON context_items
            BEGIN
              INSERT INTO context_changes (
                session_id, item_id, key, operation,
                new_value, new_metadata, category, priority, channel,
                size_delta, created_by
              ) VALUES (
                NEW.session_id, NEW.id, NEW.key, 'CREATE',
                NEW.value, NEW.metadata, NEW.category, NEW.priority, NEW.channel,
                NEW.size, 'context_save'
              );
            END;
CREATE TRIGGER IF NOT EXISTS track_context_update
            AFTER UPDATE ON context_items
            WHEN OLD.value != NEW.value OR
                 IFNULL(OLD.metadata, '') != IFNULL(NEW.metadata, '') OR
                 IFNULL(OLD.category, '') != IFNULL(NEW.category, '') OR
                 IFNULL(OLD.priority, '') != IFNULL(NEW.priority, '') OR
                 IFNULL(OLD.channel, '') != IFNULL(NEW.channel, '')
            BEGIN
              INSERT INTO context_changes (
                session_id, item_id, key, operation,
                old_value, new_value, old_metadata, new_metadata,
                category, priority, channel, size_delta, created_by
              ) VALUES (
                NEW.session_id, NEW.id, NEW.key, 'UPDATE',
                OLD.value, NEW.value, OLD.metadata, NEW.metadata,
                NEW.category, NEW.priority, NEW.channel,
                NEW.size - OLD.size, 'context_save'
              );
            END;
CREATE TRIGGER IF NOT EXISTS track_context_delete
            AFTER DELETE ON context_items
            BEGIN
              INSERT INTO context_changes (
                session_id, item_id, key, operation,
                old_value, old_metadata, category, priority, channel,
                size_delta, created_by
              ) VALUES (
                OLD.session_id, OLD.id, OLD.key, 'DELETE',
                OLD.value, OLD.metadata, OLD.category, OLD.priority, OLD.channel,
                -OLD.size, 'context_delete'
              );
            END;
CREATE TRIGGER IF NOT EXISTS increment_sequence_insert
              AFTER INSERT ON context_items
              FOR EACH ROW
              WHEN NEW.sequence_number = 0
              BEGIN
                UPDATE context_items
                SET sequence_number = (
                  SELECT COALESCE(MAX(sequence_number), 0) + 1
                  FROM context_items
                  WHERE session_id = NEW.session_id
                )
                WHERE id = NEW.id;
              END;
CREATE TRIGGER IF NOT EXISTS increment_sequence_update
              AFTER UPDATE OF value, metadata, category, priority, channel ON context_items
              FOR EACH ROW
              WHEN OLD.value != NEW.value OR
                   IFNULL(OLD.metadata, '') != IFNULL(NEW.metadata, '') OR
                   IFNULL(OLD.category, '') != IFNULL(NEW.category, '') OR
                   IFNULL(OLD.priority, '') != IFNULL(NEW.priority, '') OR
                   IFNULL(OLD.channel, '') != IFNULL(NEW.channel, '')
              BEGIN
                UPDATE context_items
                SET sequence_number = (
                  SELECT COALESCE(MAX(sequence_number), 0) + 1
                  FROM context_items
                  WHERE session_id = NEW.session_id
                )
                WHERE id = NEW.id;
              END;
CREATE TRIGGER IF NOT EXISTS update_context_items_timestamp
      AFTER UPDATE ON context_items
      BEGIN
        UPDATE context_items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
`

func (s *Store) Close() error { return s.db.Close() }

// ---------- BaseRepository ----------

func generateID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func calculateSize(v string) int { return len(v) } // Buffer.byteLength(v,'utf8')

// ---------- rows ----------

// rawItem serializes in context_items column order (what SELECT * emits),
// matching the JS non-metadata path that JSON.stringify's raw better-sqlite3 rows.
type rawItem struct {
	ID             string  `json:"id"`
	SessionID      string  `json:"session_id"`
	Key            *string `json:"key"`
	Value          *string `json:"value"`
	Category       *string `json:"category"`
	Priority       *string `json:"priority"`
	Metadata       *string `json:"metadata"`
	Size           *int64  `json:"size"`
	IsPrivate      int64   `json:"is_private"`
	Channel        *string `json:"channel"`
	CreatedAt      *string `json:"created_at"`
	UpdatedAt      *string `json:"updated_at"`
	SequenceNumber *int64  `json:"sequence_number"`
}

type session struct {
	ID               string
	Name             *string
	Description      *string
	Branch           *string
	WorkingDirectory *string
	ParentID         *string
	DefaultChannel   *string
	CreatedAt        *string
	UpdatedAt        *string
}

// CAST on TIMESTAMP columns: the JS driver returns the stored 'YYYY-MM-DD
// HH:MM:SS' string verbatim; modernc would type them as time.Time instead.
const itemCols = `id, session_id, key, value, category, priority, metadata, size, is_private, channel, CAST(created_at AS TEXT) AS created_at, CAST(updated_at AS TEXT) AS updated_at, sequence_number`

const sessionCols = `id, name, description, branch, working_directory, parent_id, default_channel, CAST(created_at AS TEXT), CAST(updated_at AS TEXT)`

func scanItem(row interface{ Scan(...any) error }) (*rawItem, error) {
	var it rawItem
	err := row.Scan(&it.ID, &it.SessionID, &it.Key, &it.Value, &it.Category,
		&it.Priority, &it.Metadata, &it.Size, &it.IsPrivate, &it.Channel,
		&it.CreatedAt, &it.UpdatedAt, &it.SequenceNumber)
	if err != nil {
		return nil, err
	}
	return &it, nil
}

func scanItems(rows *sql.Rows) ([]*rawItem, error) {
	defer rows.Close()
	var out []*rawItem
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func (s *Store) itemByID(id string) (*rawItem, error) {
	return scanItem(s.db.QueryRow(`SELECT `+itemCols+` FROM context_items WHERE id = ?`, id))
}

func (s *Store) sessionByID(id string) (*session, error) {
	var sess session
	err := s.db.QueryRow(`SELECT `+sessionCols+` FROM sessions WHERE id = ?`, id).
		Scan(&sess.ID, &sess.Name, &sess.Description, &sess.Branch, &sess.WorkingDirectory, &sess.ParentID, &sess.DefaultChannel, &sess.CreatedAt, &sess.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &sess, nil
}

func (s *Store) latestSession() (*session, error) {
	var sess session
	err := s.db.QueryRow(`SELECT `+sessionCols+` FROM sessions ORDER BY created_at DESC LIMIT 1`).
		Scan(&sess.ID, &sess.Name, &sess.Description, &sess.Branch, &sess.WorkingDirectory, &sess.ParentID, &sess.DefaultChannel, &sess.CreatedAt, &sess.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &sess, nil
}

// ensureSession mirrors index.js: current → latest → auto-create "Default Session".
func (s *Store) ensureSession() (string, error) {
	if s.hasCurrent {
		return s.currentSessionID, nil
	}
	latest, err := s.latestSession()
	if err != nil {
		return "", err
	}
	if latest != nil {
		s.currentSessionID = latest.ID
		s.hasCurrent = true
		return latest.ID, nil
	}
	ns, err := s.createSession(sessionInput{Name: "Default Session", Description: "Auto-created default session"})
	if err != nil {
		return "", err
	}
	s.currentSessionID = ns.ID
	s.hasCurrent = true
	return ns.ID, nil
}

type sessionInput struct {
	Name            string
	Description     string
	Branch          string
	WorkingDir      string
	DefaultChannel  string
}

func (s *Store) createSession(in sessionInput) (*session, error) {
	id := generateID()
	ts := isoNow(s.now())
	name := in.Name
	if name == "" {
		name = "Session " + ts
	}
	channel := in.DefaultChannel
	if channel == "" {
		channel = "general"
	}
	_, err := s.db.Exec(`INSERT INTO sessions (id, name, description, branch, working_directory, parent_id, default_channel, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, name, in.Description, nullStr(in.Branch), nullStr(in.WorkingDir), nil, channel, ts, ts)
	if err != nil {
		return nil, err
	}
	return s.sessionByID(id)
}

func nullStr(v string) any {
	if v == "" {
		return nil
	}
	return v
}

// ---------- channels.js ----------

var (
	reChannelChars = regexp.MustCompile(`[^a-z0-9\-_]`)
	reMultiDash    = regexp.MustCompile(`--+`)
)

// deriveChannelFromBranch: skip main/master, lowercase, [^a-z0-9-_]→'-',
// '--+'→'-', strip ONE leading/trailing '-', empty→'general', truncate 20.
func deriveChannelFromBranch(branch string) *string {
	b := strings.TrimSpace(branch)
	if b == "" || b == "main" || b == "master" {
		return nil
	}
	ch := reChannelChars.ReplaceAllString(strings.ToLower(b), "-")
	ch = reMultiDash.ReplaceAllString(ch, "-")
	ch = strings.TrimPrefix(ch, "-")
	ch = strings.TrimSuffix(ch, "-")
	if ch == "" {
		g := "general"
		return &g
	}
	if len(ch) > 20 {
		ch = ch[:20]
	}
	return &ch
}

func deriveDefaultChannel(branch, sessionName string) string {
	if branch != "" {
		if c := deriveChannelFromBranch(branch); c != nil {
			return *c
		}
	}
	if sessionName != "" {
		if c := deriveChannelFromBranch(sessionName); c != nil {
			return *c
		}
	}
	return "general"
}

// ---------- validation.js (validateKey) ----------

var (
	reSpace   = regexp.MustCompile(` `)
	reTab     = regexp.MustCompile("\t")
	reNL      = regexp.MustCompile("[\n\r]")
	reWS      = regexp.MustCompile(`\s`)
	reNul     = regexp.MustCompile("\x00")
	reCtrl    = regexp.MustCompile("[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]")
	reSlash   = regexp.MustCompile(`\\`)
	reQuotes  = regexp.MustCompile(`['"` + "`" + `]`)
	reShell   = regexp.MustCompile("[;|&$<>(){}\\[\\]!#~]")
	reWild    = regexp.MustCompile(`[*?]`)
	reAllowed = regexp.MustCompile(`^[a-zA-Z0-9_\-./:]+$`)
	reScript  = regexp.MustCompile(`(?i)<script|</script|javascript:|<iframe|<object|<embed|<img.*on\w+=`)
	sqlPats   = []*regexp.Regexp{
		regexp.MustCompile(`(?i);\s*(DROP|DELETE|INSERT|UPDATE|SELECT|CREATE|ALTER|TRUNCATE)`),
		regexp.MustCompile(`--\s*$`),
		regexp.MustCompile(`/\*.*\*/`),
		regexp.MustCompile(`(?i)\bUNION\s+SELECT\b`),
		regexp.MustCompile(`(?i)\bOR\s+1\s*=\s*1\b`),
	}
)

type validationError struct{ msg string }

func (e *validationError) Error() string { return e.msg }

// validateKey ports utils/validation.js check order verbatim.
func validateKey(key any) (string, error) {
	if key == nil {
		return "", &validationError{"Key cannot be null or undefined"}
	}
	ks, ok := key.(string)
	if !ok {
		return "", &validationError{"Key must be a string"}
	}
	if ks == "" {
		return "", &validationError{"Key cannot be empty"}
	}
	trimmed := strings.TrimSpace(ks)
	if trimmed == "" {
		return "", &validationError{"Key cannot be empty or contain only whitespace"}
	}
	if len(trimmed) > 255 {
		return "", &validationError{"Key too long (max 255 characters)"}
	}
	if reWS.MatchString(ks) {
		switch {
		case reSpace.MatchString(ks):
			return "", &validationError{"Key contains special characters - spaces are not allowed"}
		case reTab.MatchString(ks):
			return "", &validationError{"Key contains special characters - tabs are not allowed"}
		case reNL.MatchString(ks):
			return "", &validationError{"Key contains special characters (newlines)"}
		default:
			return "", &validationError{"Key contains special characters (whitespace)"}
		}
	}
	if reNul.MatchString(ks) {
		return "", &validationError{"Key contains invalid characters (null bytes)"}
	}
	if reCtrl.MatchString(ks) {
		return "", &validationError{"Key contains control characters"}
	}
	if reSlash.MatchString(ks) {
		return "", &validationError{"Key contains special characters (backslashes)"}
	}
	if reQuotes.MatchString(ks) {
		return "", &validationError{"Key contains quotes"}
	}
	if reShell.MatchString(ks) {
		return "", &validationError{"Key contains special characters"}
	}
	if reWild.MatchString(ks) {
		return "", &validationError{"Key contains wildcards (* or ?)"}
	}
	if !reAllowed.MatchString(ks) {
		return "", &validationError{"Key contains special characters"}
	}
	if strings.Contains(ks, "../") || strings.Contains(ks, `..\`) {
		return "", &validationError{"Key cannot contain path traversal sequences"}
	}
	for _, p := range sqlPats {
		if p.MatchString(ks) {
			return "", &validationError{"Key contains potentially malicious SQL patterns"}
		}
	}
	if reScript.MatchString(ks) {
		return "", &validationError{"Key contains potentially malicious script patterns"}
	}
	return trimmed, nil
}

// ---------- ContextRepository.save ----------

type saveInput struct {
	Key       any
	Value     string
	Category  string
	Priority  string
	IsPrivate bool
	Channel   string
	Metadata  *string
}

func (s *Store) save(sessionID string, in saveInput) (*rawItem, error) {
	key, err := validateKey(in.Key)
	if err != nil {
		return nil, err
	}
	id := generateID()
	size := calculateSize(in.Value)
	channel := in.Channel
	if channel == "" {
		var dc *string
		err := s.db.QueryRow(`SELECT default_channel FROM sessions WHERE id = ?`, sessionID).Scan(&dc)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if dc != nil && *dc != "" {
			channel = *dc
		} else {
			channel = "general"
		}
	}
	priority := in.Priority
	if priority == "" {
		priority = "normal"
	}
	priv := int64(0)
	if in.IsPrivate {
		priv = 1
	}
	var cat any
	if in.Category != "" {
		cat = in.Category
	}
	_, err = s.db.Exec(`INSERT OR REPLACE INTO context_items
		(id, session_id, key, value, category, priority, metadata, size, is_private, channel)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, sessionID, key, in.Value, cat, priority, in.Metadata, size, priv, channel)
	if err != nil {
		return nil, err
	}
	return s.itemByID(id)
}

func (s *Store) copyBetweenSessions(from, to string) int {
	rows, err := s.db.Query(`SELECT `+itemCols+` FROM context_items WHERE session_id = ? ORDER BY priority DESC, created_at DESC`, from)
	if err != nil {
		return 0
	}
	items, err := scanItems(rows)
	if err != nil {
		return 0
	}
	copied := 0
	for _, it := range items {
		channel := "general"
		if it.Channel != nil && *it.Channel != "" {
			channel = *it.Channel
		}
		_, err := s.db.Exec(`INSERT OR IGNORE INTO context_items
			(id, session_id, key, value, category, priority, metadata, size, is_private, channel, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
			generateID(), to, it.Key, it.Value, it.Category, it.Priority, it.Metadata, it.Size, it.IsPrivate, channel, it.CreatedAt)
		if err == nil {
			copied++
		}
	}
	return copied
}

// ---------- query building (queryEnhanced / searchEnhanced shared core) ----------

var sortMap = map[string]string{
	"created_desc":     "created_at DESC",
	"created_at_desc":  "created_at DESC",
	"created_asc":      "created_at ASC",
	"created_at_asc":   "created_at ASC",
	"updated_desc":     "updated_at DESC",
	"updated_at_desc":  "updated_at DESC",
	"updated_at_asc":   "updated_at ASC",
	"key_asc":          "key ASC",
	"key_desc":         "key DESC",
}

func buildSortClause(sort string) string {
	if c, ok := sortMap[sort]; ok {
		return c
	}
	if strings.Contains(sort, "priority") {
		return "priority DESC, created_at DESC"
	}
	return "created_at DESC"
}

// JS: pattern.replace(/\./g,'?').replace(/^\^/,'').replace(/\$$/,'')
var reDot = regexp.MustCompile(`\.`)

func convertToGlobPattern(p string) string {
	p = reDot.ReplaceAllString(p, "?")
	p = strings.TrimPrefix(p, "^")
	p = strings.TrimSuffix(p, "$")
	return p
}

// escapeLike mirrors query.replace(/[%_\\]/g, '\\$&')
func escapeLike(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(q)
}

type queryOpts struct {
	sessionID     string
	key           string
	category      string
	channel       string
	channels      []string
	sort          string
	limit         *int64
	offset        int64
	createdAfter  string
	createdBefore string
	keyPattern    string
	priorities    []string
	query         string
	searchIn      []string
	hasQuery      bool
}

func (s *Store) filteredQuery(o queryOpts, search bool) ([]*rawItem, int64, error) {
	var sqlStr strings.Builder
	var params []any
	sqlStr.WriteString(`SELECT ` + itemCols + ` FROM context_items WHERE (is_private = 0 OR session_id = ?)`)
	params = append(params, o.sessionID)

	now := s.now()

	if search && o.hasQuery && o.query != "" {
		var conds []string
		esc := escapeLike(o.query)
		in := o.searchIn
		if len(in) == 0 {
			in = []string{"key", "value"}
		}
		for _, f := range in {
			if f == "key" {
				conds = append(conds, `key LIKE ? ESCAPE '\'`)
				params = append(params, "%"+esc+"%")
			}
			if f == "value" {
				conds = append(conds, `value LIKE ? ESCAPE '\'`)
				params = append(params, "%"+esc+"%")
			}
		}
		if len(conds) > 0 {
			sqlStr.WriteString(` AND (` + strings.Join(conds, " OR ") + `)`)
		}
	}

	if !search && o.key != "" {
		sqlStr.WriteString(` AND key = ?`)
		params = append(params, o.key)
	}
	if o.category != "" {
		sqlStr.WriteString(` AND category = ?`)
		params = append(params, o.category)
	}
	if o.channel != "" {
		sqlStr.WriteString(` AND channel = ?`)
		params = append(params, o.channel)
	}
	if len(o.channels) > 0 {
		sqlStr.WriteString(` AND channel IN (` + strings.TrimSuffix(strings.Repeat("?,", len(o.channels)), ",") + `)`)
		for _, c := range o.channels {
			params = append(params, c)
		}
	}
	if o.createdAfter != "" {
		sqlStr.WriteString(` AND created_at > ?`)
		params = append(params, createdAfterEffective(o.createdAfter, now))
	}
	if o.createdBefore != "" {
		sqlStr.WriteString(` AND created_at < ?`)
		params = append(params, createdBeforeEffective(o.createdBefore, now))
	}
	if o.keyPattern != "" {
		sqlStr.WriteString(` AND key GLOB ?`)
		params = append(params, convertToGlobPattern(o.keyPattern))
	}
	if len(o.priorities) > 0 {
		sqlStr.WriteString(` AND priority IN (` + strings.TrimSuffix(strings.Repeat("?,", len(o.priorities)), ",") + `)`)
		for _, p := range o.priorities {
			params = append(params, p)
		}
	}

	// totalCount before pagination (JS: SELECT * → COUNT(*))
	var total int64
	countSQL := strings.Replace(sqlStr.String(), "SELECT "+itemCols, "SELECT COUNT(*) as count", 1)
	if err := s.db.QueryRow(countSQL, params...).Scan(&total); err != nil {
		return nil, 0, err
	}

	sort := o.sort
	if sort == "" && search {
		sort = "created_desc"
	}
	sqlStr.WriteString(` ORDER BY ` + buildSortClause(sort))

	// Pagination: queryEnhanced semantics — JS passes effectiveLimit only when
	// truthy; offset only when > 0. searchEnhanced passes raw values with the
	// same `if (limit)` / `if (offset && offset > 0)` guards.
	if o.limit != nil && *o.limit != 0 {
		sqlStr.WriteString(` LIMIT ?`)
		params = append(params, *o.limit)
	}
	if o.offset > 0 {
		sqlStr.WriteString(` OFFSET ?`)
		params = append(params, o.offset)
	}

	rows, err := s.db.Query(sqlStr.String(), params...)
	if err != nil {
		return nil, 0, err
	}
	items, err := scanItems(rows)
	return items, total, err
}

// queryEnhanced limit semantics: 0→unlimited, undefined/negative→100, else value.
func qeLimit(limit *int64) *int64 {
	if limit == nil || *limit < 0 {
		d := int64(100)
		return &d
	}
	if *limit == 0 {
		return nil
	}
	return limit
}

// ---------- token-limits.js ----------

type tokenConfig struct {
	mcpMaxTokens   int
	safetyBuffer   float64
	minItems       int
	maxItems       int
	charsPerToken  float64
}

func getTokenConfig() tokenConfig {
	c := tokenConfig{mcpMaxTokens: 25000, safetyBuffer: 0.8, minItems: 1, maxItems: 100, charsPerToken: 3.5}
	if v := os.Getenv("MCP_MAX_TOKENS"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n >= 1000 && n <= 100000 {
			c.mcpMaxTokens = n
		}
	}
	if v := os.Getenv("MCP_TOKEN_SAFETY_BUFFER"); v != "" {
		var f float64
		if _, err := fmt.Sscanf(v, "%g", &f); err == nil && f >= 0.1 && f <= 1.0 {
			c.safetyBuffer = f
		}
	}
	if v := os.Getenv("MCP_MIN_ITEMS"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n >= 1 && n <= 100 {
			c.minItems = n
		}
	}
	if v := os.Getenv("MCP_MAX_ITEMS"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n >= 10 && n <= 1000 {
			c.maxItems = n
		}
	}
	if v := os.Getenv("MCP_CHARS_PER_TOKEN"); v != "" {
		var f float64
		if _, err := fmt.Sscanf(v, "%g", &f); err == nil && f >= 2.5 && f <= 5.0 {
			c.charsPerToken = f
		}
	}
	if c.minItems > c.maxItems {
		c.minItems, c.maxItems = c.maxItems, c.minItems
	}
	return c
}

func estimateTokens(text string, cpt float64) int {
	return ceilf(float64(jsLen(text)) / cpt)
}

// metaItem is the includeMetadata item shape — JS key order preserved.
type metaItem struct {
	Key       *string         `json:"key"`
	Value     *string         `json:"value"`
	Category  *string         `json:"category"`
	Priority  *string         `json:"priority"`
	Channel   *string         `json:"channel"`
	Metadata  json.RawMessage `json:"metadata"`
	Size      int64           `json:"size"`
	CreatedAt *string         `json:"created_at"`
	UpdatedAt *string         `json:"updated_at"`
}

func toMetaItem(it *rawItem) metaItem {
	var meta json.RawMessage
	if it.Metadata != nil && json.Valid([]byte(*it.Metadata)) {
		meta = json.RawMessage(*it.Metadata)
	} else {
		meta = json.RawMessage("null")
	}
	size := int64(0)
	if it.Size != nil && *it.Size != 0 {
		size = *it.Size
	} else if it.Value != nil {
		size = int64(calculateSize(*it.Value))
	}
	return metaItem{
		Key: it.Key, Value: it.Value, Category: it.Category, Priority: it.Priority,
		Channel: it.Channel, Metadata: meta, Size: size,
		CreatedAt: it.CreatedAt, UpdatedAt: it.UpdatedAt,
	}
}

// estimateResponseOverhead mirrors token-limits.js — base pagination JSON
// token estimate plus a fixed 200 when metadata is included.
func estimateResponseOverhead(includeMetadata bool, c tokenConfig) int {
	type dp struct {
		Limit bool `json:"limit"`
		Sort  bool `json:"sort"`
	}
	type pg struct {
		Total            int    `json:"total"`
		Returned         int    `json:"returned"`
		Offset           int    `json:"offset"`
		HasMore          bool   `json:"hasMore"`
		NextOffset       *int64 `json:"nextOffset"`
		TotalCount       int    `json:"totalCount"`
		Page             int    `json:"page"`
		PageSize         int    `json:"pageSize"`
		TotalPages       int    `json:"totalPages"`
		HasNextPage      bool   `json:"hasNextPage"`
		HasPreviousPage  bool   `json:"hasPreviousPage"`
		PreviousOffset   *int64 `json:"previousOffset"`
		TotalSize        int    `json:"totalSize"`
		AverageSize      int    `json:"averageSize"`
		DefaultsApplied  dp     `json:"defaultsApplied"`
		Truncated        bool   `json:"truncated"`
		TruncatedCount   int    `json:"truncatedCount"`
	}
	js, _ := stringify(pg{TotalPages: 1, DefaultsApplied: dp{Limit: true, Sort: true}})
	est := estimateTokens(js, c.charsPerToken)
	if includeMetadata {
		est += 200
	}
	return est
}

func metaForCalc(it *rawItem, includeMetadata bool) string {
	if !includeMetadata {
		js, _ := stringify(it)
		return js
	}
	js, _ := stringify(toMetaItem(it))
	return js
}

func calculateSafeItemLimit(items []*rawItem, includeMetadata bool, c tokenConfig) int {
	if len(items) == 0 {
		return 0
	}
	safeTokenLimit := floorf(float64(c.mcpMaxTokens) * c.safetyBuffer)
	overhead := estimateResponseOverhead(includeMetadata, c)
	sample := items
	if len(sample) > 10 {
		sample = sample[:10]
	}
	total := 0
	for _, it := range sample {
		total += estimateTokens(metaForCalc(it, includeMetadata), c.charsPerToken)
	}
	avg := ceilf(float64(total) / float64(len(sample)))
	if avg == 0 {
		avg = 1
	}
	available := safeTokenLimit - overhead
	safeCount := available / avg
	res := safeCount
	if c.maxItems < res {
		res = c.maxItems
	}
	if len(items) < res {
		res = len(items)
	}
	if res < c.minItems {
		res = c.minItems
	}
	return res
}

// checkTokenLimit mirrors token-limits.js: build the wire-format response and
// estimate tokens on the UTF-16 length of its 2-space JSON.
func checkTokenLimit(items []*rawItem, includeMetadata bool, c tokenConfig) (exceeds bool, estTokens int, safeItemCount int) {
	var itemsOut any
	if includeMetadata {
		mi := make([]metaItem, len(items))
		for i, it := range items {
			mi[i] = toMetaItem(it)
		}
		itemsOut = mi
	} else {
		itemsOut = items
	}
	type pg struct {
		Total          int    `json:"total"`
		Returned       int    `json:"returned"`
		Offset         int    `json:"offset"`
		HasMore        bool   `json:"hasMore"`
		NextOffset     *int64 `json:"nextOffset"`
		Truncated      bool   `json:"truncated"`
		TruncatedCount int    `json:"truncatedCount"`
	}
	resp := struct {
		Items      any `json:"items"`
		Pagination pg  `json:"pagination"`
	}{Items: itemsOut, Pagination: pg{Total: len(items), Returned: len(items)}}
	js, _ := stringify(resp)
	estTokens = estimateTokens(js, c.charsPerToken)
	safeLimit := floorf(float64(c.mcpMaxTokens) * c.safetyBuffer)
	exceeds = estTokens > safeLimit
	if exceeds {
		safeItemCount = calculateSafeItemLimit(items, includeMetadata, c)
	} else {
		safeItemCount = len(items)
	}
	return
}

// calculateDynamicDefaultLimit mirrors token-limits.js.
func (s *Store) dynamicDefaultLimit(sessionID string, includeMetadata bool) int64 {
	rows, err := s.db.Query(`SELECT `+itemCols+` FROM context_items WHERE session_id = ? ORDER BY created_at DESC LIMIT 10`, sessionID)
	var sample []*rawItem
	if err == nil {
		sample, _ = scanItems(rows)
	}
	if len(sample) == 0 {
		if includeMetadata {
			return 30
		}
		return 100
	}
	safe := calculateSafeItemLimit(sample, includeMetadata, getTokenConfig())
	lim := int64((safe / 10) * 10)
	if lim < 10 {
		lim = 10
	}
	return lim
}

// ---------- git detection (session_start) ----------

func detectBranch(dir string) (branch string, detected bool) {
	head := filepath.Join(dir, ".git", "HEAD")
	if st, err := os.Stat(head); err != nil || st.IsDir() {
		return "", false
	}
	out, err := exec.Command("git", "-C", dir, "branch", "--show-current").Output()
	if err != nil {
		return "", true // repo exists, branch unknown
	}
	return strings.TrimSpace(string(out)), true
}
