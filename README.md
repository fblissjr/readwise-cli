# Readwise CLI (Bun Fork)

This is an optimized, high-performance fork of the official Readwise command-line interface for [Readwise](https://readwise.io) and [Reader](https://read.readwise.io). Search your documents & highlights, manage your reading list, tag and organize documents — all from the terminal.

Anything you can do in Readwise/Reader, your agent can now do for you.

> [!NOTE]
> **Fork Enhancements**: This fork is fully optimized for the **Bun** runtime. It introduces high-performance TUI connection pooling, double-layered schema ETag & Checksum validation caching, unified Mock/PTY testing isolation, and pristine workspace test hygiene.

## Install

To install globally using Bun:

```bash
bun install -g @readwise/cli
```

Or for local development, see the [Development](#development) section.

## Setup

### 🔑 Recommended setup: Access token login

This is the most robust and secure way to authenticate. Get your token from [readwise.io/access_token](https://readwise.io/access_token), then run:

```bash
readwise login-with-token
# Prompts for token via a secure hidden input (not stored in your shell history)
```

You can also pass the token as an argument:

```bash
readwise login-with-token <your_token>
```

Or pipe it in:

```bash
echo "$READWISE_TOKEN" | readwise login-with-token
```

> [!TIP]
> **Why this is recommended**: Direct access token flow completely avoids OAuth browser redirection, prevents local callback server port/firewall conflicts, is extremely fast, and the secure hidden CLI prompt guarantees the key is never leaked into terminal history files.

### Interactive login (opens browser)

If you prefer to authenticate via standard browser-based OAuth:

```bash
readwise login
```

Credentials are stored securely in `~/.readwise-cli.json`. OAuth tokens refresh automatically.

## Commands

Run `readwise --help` to see all available commands, or `readwise <command> --help` for details on a specific command.

### Search documents

```bash
readwise reader-search-documents --query "machine learning"
readwise reader-search-documents --query "react" --category-in article
readwise reader-search-documents --query "notes" --location-in shortlist --limit 5
readwise reader-search-documents --query "physics" --published-date-gt 2024-01-01
```

### Search highlights

```bash
readwise readwise-search-highlights --vector-search-term "spaced repetition"
```

### List and inspect documents

```bash
readwise reader-list-documents --limit 5
readwise reader-list-documents --category article --location later
readwise reader-list-documents --tag "to-review"
readwise reader-get-document-details --document-id <document-id>
readwise reader-get-document-highlights --document-id <document-id>
```

> **Tip: seen vs unseen documents.** In the response, `firstOpenedAt: null` means the document is **unseen** (never opened). A non-null `firstOpenedAt` means it has been opened/seen. Use `reader-bulk-edit-document-metadata --documents '[{"document_id":"<id>","seen":true}]'` to mark a document as seen.

### Save a document

```bash
readwise reader-create-document --url "https://example.com/article"
readwise reader-create-document \
  --url "https://example.com" \
  --title "My Article" \
  --tags "reading-list,research" \
  --notes "Found via HN"
```

### Organize

```bash
# Tags
readwise reader-list-tags
readwise reader-add-tags-to-document --document-id <id> --tag-names "important,review"
readwise reader-remove-tags-from-document --document-id <id> --tag-names "old-tag"

# Move between locations (new/later/shortlist/archive)
readwise reader-move-documents --document-ids <id> --location archive

# Edit metadata
readwise reader-bulk-edit-document-metadata --documents '[{"document_id":"<id>","title":"Better Title"}]'
readwise reader-bulk-edit-document-metadata --documents '[{"document_id":"<id>","seen":true}]'
readwise reader-bulk-edit-document-metadata --documents '[{"document_id":"<id>","notes":"Updated notes"}]'
```

### Highlight management

```bash
readwise reader-add-tags-to-highlight --document-id <id> --highlight-document-id <id> --tag-names "key-insight"
readwise reader-remove-tags-from-highlight --document-id <id> --highlight-document-id <id> --tag-names "old-tag"
readwise reader-set-highlight-notes --document-id <id> --highlight-document-id <id> --notes "This connects to..."
```

### Export

```bash
readwise reader-export-documents
readwise reader-export-documents --since-updated "2024-06-01T00:00:00Z"
```

## Options

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON (for piping to `jq`, scripts, etc.) |
| `--refresh` | Force-refresh the command list from the server |
| `--help` | Show all commands or command-specific options |

## Configuration

Manage CLI settings with the `config` command. Settings are stored in `~/.readwise-cli.json` under the `config` key.

```bash
readwise config show              # show all settings with current values
readwise config get readonly      # get a single setting
readwise config set readonly true # set a setting
```

### Readonly mode

When `readonly` is enabled, only read-only tools (search, list, get) are available — write operations (create, move, tag, edit) are hidden from commands and the TUI. This is useful for agents or scripts that should never modify your library.

```bash
readwise config set readonly true
readwise --refresh   # re-fetch tool cache with annotations
readwise --help      # only read-only commands shown
```

To restore full access:

```bash
readwise config set readonly false
readwise login   # re-authentication required
```

> **Note:** Disabling readonly via the CLI logs you out and requires re-authentication. This prevents an AI agent from silently toggling readonly off and using write tools. The TUI settings screen is not affected — toggling readonly there does not require re-login.

## Examples

Pipe results to `jq`:

```bash
readwise reader-list-documents --limit 3 --json | jq '.results[].title'
```

## Skills

Pre-built workflows your AI agent can run. Install them with one command:

```bash
readwise skills install claude    # or codex, opencode
readwise skills list              # see all available skills
```

Browse and contribute skills at [github.com/readwiseio/readwise-skills](https://github.com/readwiseio/readwise-skills).

## Looking for MCP?

Using Claude Desktop, ChatGPT, or another AI app? Connect Readwise via MCP — no terminal needed. [Set up Readwise MCP →](https://readwise.io/mcp)

## How it works

The CLI connects to the [Readwise MCP server](https://mcp2.readwise.io) internally, auto-discovers available tools, and exposes each one as a CLI command. 

* **Smart Caching Layer**: To minimize network usage and startup latency, tool schemas are cached locally (valid for 24 hours). We utilize a double-layered check:
  1. **HTTP ETag (If-None-Match)**: Checks if the schema has changed on the server without downloading the full payload (returning HTTP `304 Not Modified`).
  2. **SHA-256 Checksum Validation**: If the toolset is downloaded, it is sorted and compared via a SHA-256 hash against the cached version. If structurally identical, no cache invalidation or disk write is performed.
* **TUI Connection Pooling**: When running the interactive TUI, the CLI establishes a persistent connection pool strictly for the duration of the interactive session, eliminating handshake round-trip latencies during navigation and search.

## Development

This CLI is developed using the **Bun** runtime. Make sure Bun is installed on your local machine.

```bash
git clone https://github.com/readwise/readwise-cli && cd readwise-cli
bun install
bun run build

# Run directly without building
bun src/index.ts --help

# Run the test suite
bun test
```
