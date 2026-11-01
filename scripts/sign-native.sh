#!/usr/bin/env bash
# Signs native artifacts with a stable identity so macOS TCC consents (Screen Recording,
# Accessibility, AppleEvents) survive rebuilds. Ad-hoc signing changes the cdhash every build,
# and macOS then treats the rebuilt helper as a different app: every grant resets, every app
# re-prompts, and the supervisor's permission probe restarts the child. A stable identity
# fixes that. Fallback is ad-hoc with a loud warning so builds never hard-fail on a machine
# without the identity.
#
#   scripts/sign-native.sh <path> [more paths...]
#
# Env:
#   APPLE_CUA_CODESIGN_ID          identity name (default: "apple-cua dev")
#   APPLE_CUA_CODESIGN_KEYCHAIN    keychain path (default: <repo>/.signing/apple-cua-signing.keychain-db)
#   APPLE_CUA_CODESIGN_IDENTIFIER  code-signing identifier to stamp with --identifier. Set this to the
#                                  apple-cua-mcp bundle id (dev.applecua.mcp) for a standalone helper that
#                                  must share the MCP app's TCC grant (Accessibility, Input Monitoring)
#                                  instead of appearing as its own entry in System Settings > Privacy.
set -euo pipefail

identity="${APPLE_CUA_CODESIGN_ID:-apple-cua dev}"
identifier="${APPLE_CUA_CODESIGN_IDENTIFIER:-}"
identifier_args=()
if [[ -n "$identifier" ]]; then
	identifier_args=(--identifier "$identifier")
fi
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
keychain="${APPLE_CUA_CODESIGN_KEYCHAIN:-$repo/.signing/apple-cua-signing.keychain-db}"

if [[ ! -f "$keychain" ]]; then
	echo "sign-native: no signing keychain at $keychain; falling back to ad-hoc (TCC grants will reset on every rebuild)" >&2
	identity="-"
	keychain=""
fi

if [[ "$identity" != "-" ]]; then
	security unlock-keychain -p apple-cua-local-signing "$keychain" 2>/dev/null || true
fi

for path in "$@"; do
	if [[ "$identity" == "-" ]]; then
		codesign --force --sign - ${identifier_args[@]+"${identifier_args[@]}"} "$path"
	else
		codesign --force --sign "$identity" --keychain "$keychain" ${identifier_args[@]+"${identifier_args[@]}"} "$path"
	fi
done
