# Cloud Mail MCP Addon

MCP (Model Context Protocol) server for Cloud Mail — enables LingTai agents to send, receive, and search emails through a Cloudflare Workers-based email system.

## Requirements

- Node.js 18+
- A deployed Cloud Mail instance with the following API endpoints:
  - `POST /api/email/send-internal` — send internal email (API Key auth)
  - `POST /api/public/genToken` — admin login for public API token
  - `POST /api/public/emailList` — query emails (with token auth)
- An admin email/password account on the Cloud Mail system

## Configuration

Set the following environment variables:

| Variable | Description |
|---|---|
| `CLOUD_MAIL_URL` | Base URL of the Cloud Mail Worker (e.g. `https://mail.example.com`) |
| `CLOUD_MAIL_ADMIN_EMAIL` | Admin email for public API authentication |
| `CLOUD_MAIL_ADMIN_PASS` | Admin password for public API authentication |
| `CLOUD_MAIL_API_KEY` | The `internal_api_key` value configured on the Worker |
| `AGENT_EMAIL` | The agent's managed email address (e.g. `myagent@example.com`) |

## Tools

### `check`
Check for new/unread emails.

Parameters:
- `email` (string, optional) — Email to check (defaults to AGENT_EMAIL)
- `unread` (boolean, optional) — Only unread (default: true)
- `limit` (number, optional) — Max results (default: 10)

### `read`
Read a specific email by ID.

Parameters:
- `emailId` (number, required) — Email ID

### `send`
Send an internal email.

Parameters:
- `sender` (string, optional) — Sender email (defaults to AGENT_EMAIL)
- `receiveEmail` (string[], required) — Recipients (managed domains only)
- `subject` (string, required) — Email subject
- `content` (string, optional) — HTML body
- `text` (string, optional) — Plain text body
- `name` (string, optional) — Sender display name

### `reply`
Reply to an email.

Parameters:
- `emailId` (number, required) — Original email ID
- `content` (string, optional) — HTML reply content
- `text` (string, optional) — Plain text reply content
- `name` (string, optional) — Sender display name

### `search`
Search emails by keyword.

Parameters:
- `email` (string, optional) — Email to search (defaults to AGENT_EMAIL)
- `query` (string, required) — Search keyword
- `limit` (number, optional) — Max results (default: 20)

## Registration

To register this MCP addon in a LingTai agent, add the following to the agent's `init.json`:

```json
{
  "mcp": {
    "cloud-mail": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/cloud-mail/mcp-addon/index.js"],
      "env": {
        "CLOUD_MAIL_URL": "https://your-worker.example.com",
        "CLOUD_MAIL_ADMIN_EMAIL": "admin@yourdomain.com",
        "CLOUD_MAIL_ADMIN_PASS": "your-admin-password",
        "CLOUD_MAIL_API_KEY": "your-api-key",
        "AGENT_EMAIL": "agent@yourdomain.com"
      }
    }
  }
}
```

Then either set `AGENT_EMAIL` per agent during creation, or override in the env block above.
