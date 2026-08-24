# Contributing

Thanks for helping improve the LipDub MCP server.

## Development

There is no local Node requirement — everything runs through a pinned container image,
so CI and your machine use the byte-identical toolchain.

```bash
./manage.sh install     # dependencies
./manage.sh verify      # typecheck + lint + build + test  ← run before every PR
./manage.sh test        # tests only
./manage.sh build       # compile to dist/
```

If you prefer a local Node 20+, `npm ci && npm run verify` does the same thing.

## The rules that are not negotiable

### 1. Never generate tool descriptions from the upstream OpenAPI document

`https://api.lipdub.ai/openapi.json` is public and it is tempting to code-generate
against it. **Do not.** Its descriptions are raw Python docstrings that carry internal
parameter names, dependency-injection vocabulary and internal component names. A
generator copies all of that into a tool description, which is then read verbatim by
every language model that connects.

Hand-write every description. If you want type safety against the API, generate
*types* only, and keep the prose separate.

The same applies to error text: never forward an upstream error body. Map it onto one
of the fixed messages in `src/lipdub/errors.ts`. That module is an allowlist by design
— a denylist fails the first time someone upstream adds a new internal noun.

### 2. Nothing may be written to stdout

On the stdio transport, stdout carries the JSON-RPC frames. A single `console.log`
corrupts the stream and the client reports an undiagnosable connection failure. Use the
logger in `src/logging.ts`, which writes to stderr. The `no-console` lint rule and
`test/no-stdout.test.ts` both enforce this.

### 3. The API key never leaves its lane

It is read from the environment, sent only to `api.lipdub.ai`, and redacted from every
log line and error message. It must never be a tool parameter (that would place it in
the model's context, where prompt injection can exfiltrate it), never a CLI argument
(argv is readable by other processes and lands in shell history), and never persisted.

### 4. Treat upstream strings as untrusted input to the model

Anything echoed back from the API — a filename, a failure reason — reaches a language
model's context. Run it through `sanitizeUpstreamText` and prefer one of our own
messages over the upstream text.

## Writing tool descriptions

Descriptions are read by a model deciding what to do next, so:

- State the cost up front if the tool spends money.
- End with the concrete next step ("call `lipdub_wait_for_render` with that
  render_id"), because agents follow chained instructions far more reliably than they
  infer a workflow.
- Say plainly what the product does *not* do. The most common and most expensive agent
  mistake with this API is assuming "dub" implies translation.
- Prefer one clear vocabulary over mirroring the API's internal one.

## Leak scanning

`test/no-secrets.test.ts` scans the compiled artifact and the public docs.

It runs two passes. **Structural patterns** live in `test/helpers/leak-scan.ts` and
describe the *shape* of a leak — a Python docstring block, an internal-looking
hostname, a confidentiality banner. They name no internal system, so they are safe to
keep in a public repository.

The **codename list is deliberately not in this repository**: a public file
enumerating internal system names would disclose exactly what it exists to protect. CI
supplies it at scan time through `LIPDUB_FORBIDDEN_TERMS_FILE`, a newline-delimited
file. Locally that pass is skipped and the structural pass still runs.

If the scan fails, rewrite the text. Do not add an exemption.

## Tests

- Every status mapping and error translation needs a case. The upstream job status
  vocabulary has seven values and the ingest vocabulary has four; a change that adds a
  branch should add a test that walks it.
- Use the scripted-fetch helper in `test/renders.test.ts` rather than mocking the
  client — it exercises the real request path, including content-type sniffing.

## Pull requests

Run `./manage.sh verify` and make sure it is green. Describe user-visible changes in
`CHANGELOG.md`. If you change a tool description, say so explicitly in the PR — those
are the public contract and get reviewed more closely than code.
