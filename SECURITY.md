# Security policy

## Reporting a vulnerability

Please report security issues **privately**, not as a public GitHub issue.

- Preferred: [GitHub private vulnerability reporting](https://github.com/marzvfx/lipdub-mcp/security/advisories/new)
- Or email: **security@lipdub.ai**

Include what you found, how to reproduce it, and what an attacker could achieve.
We aim to acknowledge within 3 business days and to keep you updated until it is
resolved. Please give us a reasonable window to ship a fix before disclosing publicly.

## Never paste an API key into an issue

LipDub currently issues **one API key per user**, and that key is not scoped, does not
expire, and can only be revoked by regenerating it — which breaks every other
integration on the account at the same time.

So a key pasted into an issue, a gist, or a debug transcript is a serious problem, and
an awkward one to clean up. If you think a key has been exposed, regenerate it at
[Settings → API Keys](https://app.lipdub.ai/settings/api-keys) and expect to update
every other place it is used.

## How this server handles your key

- Read only from the `LIPDUB_API_KEY` environment variable, or a file named by
  `LIPDUB_API_KEY_FILE`.
- **Never** accepted as a tool parameter. A tool parameter would put the key into the
  language model's context, where prompt injection could exfiltrate it in a single
  call.
- **Never** accepted as a command-line argument, because argv is readable by other
  processes on the machine and ends up in shell history.
- Never written to disk, never cached, never included in telemetry — this server sends
  none.
- Redacted from every log line and every error message, by literal value, so that an
  HTTP client exception embedding request headers cannot leak it.
- Sent to exactly one origin: `https://api.lipdub.ai` (or an explicit
  `LIPDUB_API_BASE_URL` override, which is intended for testing).

## Things to be aware of

**Download links are credentials.** `lipdub_get_render` returns a signed, time-limited
URL. Anyone holding that string can fetch the video without authenticating. Treat it
like a password: do not paste it into a public channel, and prefer to download the file
rather than store the link.

**Render listing is account-wide.** `lipdub_list_renders` returns renders for the whole
LipDub account, not just the ones you started.

**Renders spend real money.** `lipdub_create_render` charges credits and is not
idempotent — calling it twice produces two renders and two charges. The
`confirm_spend` gate and `LIPDUB_MAX_RENDERS_PER_SESSION` limit exist to slow down a
looping agent, but they are usability guardrails, not security controls: anything
calling the API directly bypasses them.

**Prompt injection is a real risk for any agent tool.** If your agent reads untrusted
web content in the same session it has this server connected, that content can attempt
to make it start renders or reveal download links. Keep the human confirmation step
enabled.

## Supply chain

The official package is **`lipdub-mcp`** on npm, published from this repository with
provenance attestation. If you find a similarly named package claiming to be the LipDub
MCP server, it is not ours — please report it.
