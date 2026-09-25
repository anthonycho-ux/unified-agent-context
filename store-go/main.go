package main

// uac-store — drop-in Go replacement for the mcp-memory-keeper Node server,
// implementing exactly the four tools UAC calls:
//   context_session_start, context_save, context_get, context_search
//
// Modes:
//   uac-store                          → MCP server on stdio (same as index.js)
//   uac-store call <tool> '<json>'     → one-shot CLI mode (no MCP handshake);
//                                       prints the same text the tool returns.
//
// DB: $DATA_DIR/context.db (same file, same schema — no migration).

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func dataDir() string {
	if d := os.Getenv("DATA_DIR"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepathJoin(home, ".uac", "data", "memory")
}

func filepathJoin(parts ...string) string {
	out := parts[0]
	for _, p := range parts[1:] {
		if len(out) > 0 && out[len(out)-1] != '/' {
			out += "/"
		}
		out += p
	}
	return out
}

func main() {
	if len(os.Args) >= 3 && os.Args[1] == "call" {
		runCall(os.Args[2], os.Args[3:])
		return
	}
	serve()
}

// ---------- CLI mode ----------

func runCall(tool string, argJSON []string) {
	st, err := Open(dataDir())
	if err != nil {
		fmt.Fprintf(os.Stderr, "uac-store: open db: %v\n", err)
		os.Exit(1)
	}
	defer st.Close()

	args := map[string]any{}
	if len(argJSON) > 0 && argJSON[0] != "" {
		if err := json.Unmarshal([]byte(argJSON[0]), &args); err != nil {
			fmt.Fprintf(os.Stderr, "uac-store: bad args JSON: %v\n", err)
			os.Exit(2)
		}
	}

	text, _ := dispatch(st, tool, args)
	fmt.Println(text)
}

func dispatch(st *Store, tool string, args map[string]any) (string, bool) {
	switch tool {
	case "context_session_start":
		return st.handleSessionStart(args)
	case "context_save":
		return st.handleSave(args)
	case "context_get":
		return st.handleGet(args)
	case "context_search":
		return st.handleSearch(args)
	}
	return fmt.Sprintf("Unknown tool: %s", tool), true
}

// ---------- MCP stdio mode ----------

func serve() {
	st, err := Open(dataDir())
	if err != nil {
		fmt.Fprintf(os.Stderr, "uac-store: open db: %v\n", err)
		os.Exit(1)
	}
	defer st.Close()

	s := server.NewMCPServer("memory-keeper", "0.5.0", server.WithToolCapabilities(false))

	s.AddTool(mcp.NewTool("context_session_start",
		mcp.WithDescription("Start a new context session with optional project directory for git tracking"),
		mcp.WithString("name", mcp.Description("Session name")),
		mcp.WithString("description", mcp.Description("Session description")),
		mcp.WithString("continueFrom", mcp.Description("Session ID to continue from")),
		mcp.WithString("projectDir", mcp.Description("Project directory path for git tracking (e.g., \"/path/to/your/project\")")),
		mcp.WithString("defaultChannel", mcp.Description("Default channel for context items (auto-derived from git branch if not provided)")),
	), wrap(st, "context_session_start"))

	s.AddTool(mcp.NewTool("context_save",
		mcp.WithDescription("Save a context item with optional category, priority, and privacy setting"),
		mcp.WithString("key", mcp.Required(), mcp.Description("Unique key for the context item")),
		mcp.WithString("value", mcp.Required(), mcp.Description("Context value to save")),
		mcp.WithString("category", mcp.Description("Category (e.g., task, decision, progress)"), mcp.Enum("task", "decision", "progress", "note", "error", "warning")),
		mcp.WithString("priority", mcp.Description("Priority level"), mcp.Enum("high", "normal", "low"), mcp.DefaultString("normal")),
		mcp.WithBoolean("private", mcp.Description("If true, item is only accessible from the current session. Default: false (accessible from all sessions)"), mcp.DefaultBool(false)),
		mcp.WithString("channel", mcp.Description("Channel to organize this item (uses session default if not provided)")),
	), wrap(st, "context_save"))

	s.AddTool(mcp.NewTool("context_get",
		mcp.WithDescription("Retrieve saved context by key, category, or session with enhanced filtering. Returns all accessible items (public items + own private items)"),
		mcp.WithString("key", mcp.Description("Specific key to retrieve")),
		mcp.WithString("category", mcp.Description("Filter by category")),
		mcp.WithString("sessionId", mcp.Description("Specific session ID (defaults to current)")),
		mcp.WithString("channel", mcp.Description("Filter by single channel")),
		mcp.WithArray("channels", mcp.Description("Filter by multiple channels"), mcp.Items(map[string]any{"type": "string"})),
		mcp.WithBoolean("includeMetadata", mcp.Description("Include timestamps and size info")),
		mcp.WithString("sort", mcp.Description("Sort order for results"), mcp.Enum("created_desc", "created_asc", "updated_desc", "key_asc", "key_desc")),
		mcp.WithNumber("limit", mcp.Description("Maximum items to return. Must be a positive integer. Invalid values will cause validation error. (default: auto-derived)")),
		mcp.WithNumber("offset", mcp.Description("Pagination offset. Must be a non-negative integer. Invalid values will cause validation error. (default: 0)")),
		mcp.WithString("createdAfter", mcp.Description("ISO date - items created after this time")),
		mcp.WithString("createdBefore", mcp.Description("ISO date - items created before this time")),
		mcp.WithString("keyPattern", mcp.Description("Regex pattern for key matching")),
		mcp.WithArray("priorities", mcp.Description("Filter by priority levels"), mcp.Items(map[string]any{"type": "string", "enum": []string{"high", "normal", "low"}})),
	), wrap(st, "context_get"))

	s.AddTool(mcp.NewTool("context_search",
		mcp.WithDescription("Search through saved context items with advanced filtering"),
		mcp.WithString("query", mcp.Required(), mcp.Description("Search query")),
		mcp.WithArray("searchIn", mcp.Description("Fields to search in"), mcp.Items(map[string]any{"type": "string", "enum": []string{"key", "value"}}), mcp.DefaultArray([]string{"key", "value"})),
		mcp.WithString("sessionId", mcp.Description("Session to search (defaults to current)")),
		mcp.WithString("category", mcp.Description("Filter by category")),
		mcp.WithString("channel", mcp.Description("Filter by single channel")),
		mcp.WithArray("channels", mcp.Description("Filter by multiple channels"), mcp.Items(map[string]any{"type": "string"})),
		mcp.WithString("createdAfter", mcp.Description("ISO date - items created after this time")),
		mcp.WithString("createdBefore", mcp.Description("ISO date - items created before this time")),
		mcp.WithString("relativeTime", mcp.Description("Natural language time (e.g., \"2 hours ago\", \"yesterday\")")),
		mcp.WithString("keyPattern", mcp.Description("Pattern for key matching (uses GLOB syntax)")),
		mcp.WithArray("priorities", mcp.Description("Filter by priority levels"), mcp.Items(map[string]any{"type": "string", "enum": []string{"high", "normal", "low"}})),
		mcp.WithString("sort", mcp.Description("Sort order for results"), mcp.Enum("created_desc", "created_asc", "updated_desc", "key_asc", "key_desc")),
		mcp.WithNumber("limit", mcp.Description("Maximum items to return. Must be a positive integer. Invalid values will cause validation error. (default: auto-derived)")),
		mcp.WithNumber("offset", mcp.Description("Pagination offset. Must be a non-negative integer. Invalid values will cause validation error. (default: 0)")),
		mcp.WithBoolean("includeMetadata", mcp.Description("Include timestamps and size info")),
	), wrap(st, "context_search"))

	if err := server.ServeStdio(s); err != nil {
		fmt.Fprintf(os.Stderr, "uac-store: %v\n", err)
		os.Exit(1)
	}
}

func wrap(st *Store, tool string) server.ToolHandlerFunc {
	return func(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		text, _ := dispatch(st, tool, req.GetArguments())
		return mcp.NewToolResultText(text), nil
	}
}
