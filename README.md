# LipDub MCP server

Give your AI agent the ability to lip-sync video.

[LipDub 2](https://lipdub.ai) makes a person in a video appear to speak a different
audio track, with matched lip movement. This is an [MCP](https://modelcontextprotocol.io)
server that exposes it to Claude, Cursor, Gemini CLI, Codex, VS Code, and any other
MCP-compatible client.

> **LipDub 2 does not translate, transcribe, or generate speech.** You bring the audio.
> If you want a video dubbed into another language, generate that audio first with a
> text-to-speech or voice-cloning tool, host it at a public URL, and pass that URL.
> This server composes well with a TTS server — that is the intended workflow.

---

## What it looks like

```
You:   Lip-sync https://example.com/keynote.mp4 to https://example.com/spanish.mp3

Claude: I'll use LipDub 2 for that. This will charge credits to your LipDub
        account and can't be refunded — shall I go ahead?

You:   yes

Claude: Started — render_id rnd_88213. This usually takes 7–15 minutes; I'll wait.
        ...
        Done. Here's your video: https://…  (link expires, so grab it soon)
```

---

## Setup

### 1. Get an API key

1. Sign in at [app.lipdub.ai](https://app.lipdub.ai).
2. Open **Settings → API Keys**: [app.lipdub.ai/settings/api-keys](https://app.lipdub.ai/settings/api-keys)

   You must be an **Owner** or **Admin** on the account. Other roles are redirected to
   the dashboard with no explanation — if that link bounces you, ask an Owner or Admin
   on your team to generate the key for you.
3. Generate a key and copy it.

> **One key per user.** LipDub issues a single API key per user, and generating a new
> one **replaces** the old one. If your account already uses its key for another
> integration, generating a fresh key will break it. Reuse the existing key, or use a
> separate Owner/Admin account for agent work.

### 2. Add the server

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add lipdub --env LIPDUB_API_KEY=your_key_here -- npx -y lipdub-mcp
```
</details>

<details>
<summary><b>Claude Desktop</b> — <code>claude_desktop_config.json</code></summary>

```json
{
  "mcpServers": {
    "lipdub": {
      "command": "npx",
      "args": ["-y", "lipdub-mcp"],
      "env": { "LIPDUB_API_KEY": "your_key_here" }
    }
  }
}
```
</details>

<details>
<summary><b>Cursor</b> — <code>.cursor/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "lipdub": {
      "command": "npx",
      "args": ["-y", "lipdub-mcp"],
      "env": { "LIPDUB_API_KEY": "your_key_here" }
    }
  }
}
```
</details>

<details>
<summary><b>VS Code</b> — <code>.vscode/mcp.json</code> (recommended: prompts for the key)</summary>

```json
{
  "inputs": [
    { "type": "promptString", "id": "lipdub-key", "description": "LipDub API Key", "password": true }
  ],
  "servers": {
    "lipdub": {
      "command": "npx",
      "args": ["-y", "lipdub-mcp"],
      "env": { "LIPDUB_API_KEY": "${input:lipdub-key}" }
    }
  }
}
```

This pattern keeps the key out of a file you might commit. Given that LipDub issues
one key per user, that matters more here than it does for most servers.
</details>

<details>
<summary><b>Gemini CLI</b> — <code>~/.gemini/settings.json</code></summary>

```json
{
  "mcpServers": {
    "lipdub": {
      "command": "npx",
      "args": ["-y", "lipdub-mcp"],
      "env": { "LIPDUB_API_KEY": "your_key_here" }
    }
  }
}
```
</details>

<details>
<summary><b>Codex</b> — <code>~/.codex/config.toml</code></summary>

```toml
[mcp_servers.lipdub]
command = "npx"
args = ["-y", "lipdub-mcp"]
env = { LIPDUB_API_KEY = "your_key_here" }
```
</details>

### 3. Check it works

Ask your agent: **"check my LipDub connection"**.

---

## Tools

| Tool | What it does | Costs credits? |
| --- | --- | --- |
| `lipdub_check_connection` | Confirms the key works and names the account | No |
| `lipdub_create_render` | Starts a render from a video URL and an audio URL | **Yes** |
| `lipdub_get_render` | Status, and the download link once ready | No |
| `lipdub_wait_for_render` | Waits for a render instead of polling in a loop | No |
| `lipdub_list_renders` | Recent renders, to recover a lost render id | No |

There is also a `lipdub_quick_dub` prompt (a slash command in clients that support
prompts) and two reference resources, `lipdub://guide/quickstart` and
`lipdub://guide/troubleshooting`.

---

## What makes a good source video

- **One** person on camera.
- Face clearly visible and reasonably well lit.
- Video: `.mp4`, `.mov`, `.avi`, `.webm`. Audio: `.mp3`, `.wav`, `.m4a`, `.aac`.

---

## Hosting your files

Both inputs are **public URLs**, not local file paths. The link must return the media
file itself.

These do **not** work: Google Drive, Dropbox and YouTube *share pages*; anything behind
a login; expired links.

These do:

```bash
# Amazon S3 — a time-limited direct link
aws s3 presign s3://your-bucket/keynote.mp4 --expires-in 3600

# Google Cloud Storage
gcloud storage sign-url gs://your-bucket/keynote.mp4 --duration=1h

# Any web server
scp keynote.mp4 you@yourserver:/var/www/html/
# → https://yourserver/keynote.mp4
```

> **Why URLs and not local files?** A URL-based render is one API call. The
> upload-a-local-file path is several calls against endpoints that are rate-limited to
> roughly ten requests an hour, which works out at about two local-file renders per
> hour on the entry plan. Keeping this server URL-only also means it behaves
> identically wherever it runs. Local-file support may arrive later behind an opt-in.

---

## Timing and cost

A render takes about **7–15 minutes**. Renders consume credits from your LipDub
account and cannot be refunded; cost scales with the length of the source video, so
shorter clips cost less.

Checking status is **free and never rate-limited** — poll as often as you like.

Your credit balance is not available through the API; see
[app.lipdub.ai](https://app.lipdub.ai).

### Spending guardrails

`lipdub_create_render` is the only tool that spends money. By default it refuses to run
until the agent passes `confirm_spend`, which forces it to state the cost to you first.
The server also stops after 5 renders per session.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LIPDUB_API_KEY` | — | Your API key. Required. |
| `LIPDUB_API_KEY_FILE` | — | Path to a file containing the key, instead of the variable. |
| `LIPDUB_MAX_RENDERS_PER_SESSION` | `5` | Ceiling on renders started per server process. |
| `LIPDUB_REQUIRE_SPEND_CONFIRMATION` | `true` | Set `false` only for headless pipelines with no human watching. |
| `LIPDUB_LOG_LEVEL` | `warn` | `debug`, `info`, `warn`, `error`. Logs go to stderr. |

These are usability guardrails, not security controls — anything calling the API
directly bypasses them.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "No LipDub API key is configured" | Generate one at [Settings → API Keys](https://app.lipdub.ai/settings/api-keys) and set `LIPDUB_API_KEY` |
| "LipDub rejected the API key" | The key was mistyped or has been regenerated. Generate a fresh one and restart the client |
| "out of credits" | Top up at [app.lipdub.ai](https://app.lipdub.ai) |
| "could not download one of your source files" | The link is a share page, needs a login, or has expired. Use a direct link |
| "downloaded your files but could not start the render" | Usually no credits, or no clearly visible speaking face |
| Wait tool returned `timed_out_waiting` | Normal — renders take 7–15 minutes. Not a failure; call it again |
| Download link stopped working | Links are signed and short-lived. Call `lipdub_get_render` again |

Full API documentation: [lipdub.readme.io](https://lipdub.readme.io/)

---

## Privacy

- Your API key is read from the environment, is used only to call
  `https://api.lipdub.ai`, and is never written to disk, logged, or included in any
  tool result. It is redacted from every log line and error message.
- The video and audio URLs you supply are sent to the LipDub API, which downloads them
  to produce the render. Do not pass URLs to material you are not willing to have
  LipDub process.
- This server sends no telemetry and collects no analytics.
- Renders and their outputs are stored in your LipDub account, governed by LipDub's
  privacy policy and terms.

## Acceptable use

LipDub 2 generates synthetic video of real people. By using it you warrant that you
have the rights and consent necessary for the likeness and the voice in your source
material. Do not use it to impersonate anyone without their permission, to create
misleading content about real people, or for anything prohibited by LipDub's terms.

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md). Please do not open a public
issue, and never paste an API key into one.

## Limitations

- No translation or speech generation — you supply the audio.
- URL inputs only; no local file upload.
- Credit balance and price estimates are not available through the API.
- LipDub issues one API key per user, so a key cannot be scoped to this server alone.

## Versioning

Tool names are a public contract and will not change. New capability arrives as new
tools; schema changes are additive. See [CHANGELOG.md](CHANGELOG.md).

## Licence

[Apache-2.0](LICENSE). This licence covers this client. LipDub itself is a commercial
service governed by its own terms.
