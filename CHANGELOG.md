# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

Tool names are a public contract: they will not be renamed or removed within a major
version. New capability arrives as new tools, and input schema changes are additive.

## [Unreleased]

## [0.1.1] — 2026-08-26

### Fixed

- The README published to npm still told people to clone and build, and said the
  package was not on npm yet. It was published moments after that text was written, so
  the registry page contradicted itself. Spotted by Pat.
- Tightened the prose throughout. Halved the em-dash count, dropped a few empty
  intensifiers, and removed a line congratulating the server on its own design.
- Called the Basic plan legacy, which is what it is.

## [0.1.0] — 2026-08-25

First release.

### Added

- Initial server with five tools: `lipdub_check_connection`, `lipdub_create_render`,
  `lipdub_get_render`, `lipdub_wait_for_render` and `lipdub_list_renders`.
- A `lipdub_quick_dub` prompt, and `lipdub://guide/quickstart` and
  `lipdub://guide/troubleshooting` resources.
- Unified render status: the API's two tracking endpoints and their two separate status
  vocabularies (eleven values in total) are presented as one identifier and one
  five-phase lifecycle, so an agent never has to know about the handoff between them.
- Spend confirmation on `lipdub_create_render`, plus a per-session render ceiling.
- Automatic output filename derivation, since the API requires a filename that is
  meaningless to an agent but visible to the customer in the LipDub web app.
