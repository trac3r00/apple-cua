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
#   APPLE_CUA_CODESIGN_ID        identity name (default: "apple-cua dev")
#   APPLE_CUA_CODESIGN_KEYCHAIN  keychain path (default: <repo>/.signing/apple-cua-signing.keychain-db)
set -euo pipefail

identity="${APPLE_CUA_CODESIGN_ID:-apple-cua dev}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
keychain="${APPLE_CUA_CODESIGN_KEYCHAIN:-$repo/.signing/apple-cua-signing.keychain-db}"

if [[ ! -f "$keychain" ]]; then
	echo "sign-native: no signing keychain at $keychain; falling back to ad-hoc (TCC grants will reset on every rebuild)" >&2
	identity="-"
	keychain=""
fi

for path in "$@"; do
	if [[ "$identity" == "-" ]]; then
		codesign --force --sign - "$path"
	else
		if ! security find-identity -p codesigning -v "$keychain" 2>/dev/null | grep -q "$identity"; then
			security unlock-keychain -p apple-cua-local-signing "$keychain" 2>/dev/null || true
		fi
		codesign --force --sign "$identity" --keychain "$keychain" "$path"
	fi
done
