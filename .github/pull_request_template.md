## What this changes

<!-- One or two sentences. If it fixes an issue, link it. -->

## Why

<!-- What problem does this solve? -->

## Checklist

- [ ] `./manage.sh verify` passes (typecheck, lint, build, tests)
- [ ] New behaviour has a test that would fail without the change
- [ ] `CHANGELOG.md` updated if the change is user-visible

### If you touched a tool description, an error message, or the README

These are the public contract that language models read, so they get closer review
than code does.

- [ ] Written by hand, not generated from the upstream OpenAPI document — see
      CONTRIBUTING.md for why that matters
- [ ] Says what to do next, not just what went wrong
- [ ] Mentions no internal system, component or model name
- [ ] No upstream error body is forwarded to the caller
