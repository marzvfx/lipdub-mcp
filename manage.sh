#!/usr/bin/env bash
# Dockerized Node toolchain.
#
# This workstation has no local Node and no sudo, and the wider codebase already
# runs its toolchains inside containers (see lipdub-app's manage_workspace.sh), so
# every npm/node command for this repo goes through a pinned container image. That
# also means CI and a developer laptop run the byte-identical toolchain.
#
#   ./manage.sh install            install dependencies (npm ci, falling back to npm install)
#   ./manage.sh verify             typecheck + lint + build + test (the pre-claim gate)
#   ./manage.sh test [args...]     run vitest
#   ./manage.sh build              compile TypeScript to dist/
#   ./manage.sh run [args...]      run the built server (stdio)
#   ./manage.sh npm  [args...]     arbitrary npm command
#   ./manage.sh shell              interactive shell in the toolchain container
set -euo pipefail

readonly NODE_IMAGE="node:22-alpine"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --interactive keeps stdin attached so the stdio server can actually be driven by
# hand; --tty is deliberately omitted because it would corrupt the JSON-RPC framing.
docker_run() {
  docker run --rm --interactive \
    --volume "${REPO_ROOT}:/work" \
    --workdir /work \
    --env HOME=/tmp \
    --env "LIPDUB_API_KEY=${LIPDUB_API_KEY:-}" \
    --env "LIPDUB_API_BASE_URL=${LIPDUB_API_BASE_URL:-}" \
    --user "$(id -u):$(id -g)" \
    "${NODE_IMAGE}" "$@"
}

main() {
  local command="${1:-verify}"
  shift || true

  case "${command}" in
    install)
      # npm ci requires a lockfile; on a first run there isn't one yet.
      if [[ -f "${REPO_ROOT}/package-lock.json" ]]; then
        docker_run npm ci "$@"
      else
        docker_run npm install "$@"
      fi
      ;;
    verify) docker_run npm run verify ;;
    test) docker_run npx vitest run "$@" ;;
    build) docker_run npm run build ;;
    run) docker_run node dist/index.js "$@" ;;
    npm) docker_run npm "$@" ;;
    shell) docker run --rm -it --volume "${REPO_ROOT}:/work" --workdir /work --env HOME=/tmp "${NODE_IMAGE}" sh ;;
    *)
      echo "unknown command: ${command}" >&2
      sed -n '3,20p' "${BASH_SOURCE[0]}" >&2
      exit 64
      ;;
  esac
}

main "$@"
