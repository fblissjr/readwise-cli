# Readwise CLI (Bun Fork)

This is an optimized, high-performance fork of the official Readwise command-line interface for [Readwise](https://readwise.io) and [Reader](https://read.readwise.io). Search your documents & highlights, manage your reading list, tag and organize documents — all from the terminal.

Anything you can do in Readwise/Reader, your agent can now do for you.

> [!NOTE]
> **Fork Enhancements**: This fork is fully optimized for the **Bun** runtime. It introduces high-performance TUI connection pooling, double-layered schema ETag & Checksum validation caching, unified Mock/PTY testing isolation, and pristine workspace test hygiene.

## Run Modes & Setup

This fork offers two ways to run and use the CLI:

### 1. 🛠️ Development Mode (`bun run dev`) - Recommended
Use this mode to execute TypeScript source code directly without a build step. Code edits are reflected instantly!
Prefix all commands with `bun run dev`:
```bash
bun run dev <command>
```

### 2. 🌍 Global Linked Mode (`bun link`)
If you want to use the CLI as a standard global `readwise` command across your whole system, compile and symlink the local repository:
1. Compile the TypeScript codebase:
   ```bash
   bun run build
   ```
2. Symlink the command globally:
   ```bash
   bun link
   ```
Now you can execute the command from any directory on your machine:
```bash
readwise <command>
```
> [!TIP]
> **Zero Rebuilds in Dev**: Because this fork features an intelligent binary wrapper (`bin/readwise.js`), when you execute the globally-linked `readwise` command inside or relative to your development workspace, it will automatically detect the TypeScript source and run it on-the-fly via Bun. You do not need to rebuild the project while editing code! It falls back to the compiled `dist/index.js` production bundle only if you run it outside the workspace or on a machine without Bun.

---

## Setup & Authentication

### 🔑 Recommended Setup: Access token login

This is the most robust and secure way to authenticate. Get your token from [readwise.io/access_token](https://readwise.io/access_token), then run (using your preferred run mode):

```bash
bun run dev login-with-token
# Or if globally linked:
# readwise login-with-token
```
*(Prompts for token via a secure hidden input not stored in your shell history)*

You can also pass the token as an argument:

```bash
bun run dev login-with-token <your_token>
```

Or pipe it in:

```bash
echo "$READWISE_TOKEN" | bun run dev login-with-token
```

> [!TIP]
> **Why this is recommended**: Direct access token flow completely avoids OAuth browser redirection, prevents local callback server port/firewall conflicts, is extremely fast, and the secure hidden CLI prompt guarantees the key is never leaked into terminal history files.

### Interactive login (opens browser)

If you prefer to authenticate via standard browser-based OAuth:

```bash
bun run dev login
```

Credentials are stored securely in `~/.readwise-cli.json`. OAuth tokens refresh automatically.

## Commands

Run `bun run dev --help` (or the globally linked `readwise --help`) to see all available commands, or `bun run dev <command> --help` for details on a specific command.

### Search documents

```bash
bun run dev reader-search-documents --query "machine learning"
bun run dev reader-search-documents --query "react" --category-in article
bun run dev reader-search-documents --query "notes" --location-in shortlist --limit 5
bun run dev reader-search-documents --query "physics" --published-date-gt 2024-01-01
```

### Search highlights

```bash
bun run dev readwise-search-highlights --vector-search-term "spaced repetition"
```

### List and inspect documents

```bash
bun run dev reader-list-documents --limit 5
bun run dev reader-list-documents --category article --location later
bun run dev reader-list-documents --tag "to-review"
bun run dev reader-get-document-details --document-id <document-id>
bun run dev reader-get-document-highlights --document-id <document-id>
```

> **Tip: seen vs unseen documents.** In the response, `firstOpenedAt: null` means the document is **unseen** (never opened). A non-null `firstOpenedAt` means it has been opened/seen. Use `reader-bulk-edit-document-metadata --documents '[{"document_id":"<id>","seen":true}]'` to mark a document as seen.

### Save a document

```bash
bun run dev reader-create-document --url "https://example.com/article"
bun run dev reader-create-document \
  --url "https://example.com" \
  --title "My Article" \
  --tags "reading-list,research" \
  --notes "Found via HN"
```

### Organize

```bash
# Tags
bun run dev reader-list-tags
bun run dev reader-add-tags-to-document --document-id <id> --tag-names "important,review"
bun run dev reader-remove-tags-from-document --document-id <id> --tag-names "old-tag"

# Move between locations (new/later/shortlist/archive)
bun run dev reader-move-documents --document-ids <id> --location archive

# Edit metadata
bun run dev reader-bulk-edit-document-metadata --documents '[{"document_id":"<id>","title":"Better Title"}]'
bun run dev reader-bulk-edit-document-metadata --documents '[{"document_id":"<id>","seen":true}]'
bun run dev reader-bulk-edit-document-metadata --documents '[{"document_id":"<id>","notes":"Updated notes"}]'
```

### Highlight management

```bash
bun run dev reader-add-tags-to-highlight --document-id <id> --highlight-document-id <id> --tag-names "key-insight"
bun run dev reader-remove-tags-from-highlight --document-id <id> --highlight-document-id <id> --tag-names "old-tag"
bun run dev reader-set-highlight-notes --document-id <id> --highlight-document-id <id> --notes "This connects to..."
```

### Export

```bash
bun run dev reader-export-documents
bun run dev reader-export-documents --since-updated "2024-06-01T00:00:00Z"
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
bun run dev config show              # show all settings with current values
bun run dev config get readonly      # get a single setting
bun run dev config set readonly true # set a setting
```

### Readonly mode

When `readonly` is enabled, only read-only tools (search, list, get) are available — write operations (create, move, tag, edit) are hidden from commands and the TUI. This is useful for agents or scripts that should never modify your library.

```bash
bun run dev config set readonly true
bun run dev --refresh   # re-fetch tool cache with annotations
bun run dev --help      # only read-only commands shown
```

To restore full access:

```bash
bun run dev config set readonly false
bun run dev login   # re-authentication required
```

> **Note:** Disabling readonly via the CLI logs you out and requires re-authentication. This prevents an AI agent from silently toggling readonly off and using write tools. The TUI settings screen is not affected — toggling readonly there does not require re-login.

## Examples

Pipe results to `jq`:

```bash
bun run dev reader-list-documents --limit 3 --json | jq '.results[].title'
```

## Skills

Pre-built workflows your AI agent can run. Install them with one command:

```bash
bun run dev skills install claude    # or codex, opencode
bun run dev skills list              # see all available skills
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

# Run in Development Mode (runs TS source directly)
bun run dev --help

# Run the test suite
bun test
```
