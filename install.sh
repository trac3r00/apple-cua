#!/usr/bin/env bash
# Installs apple-cua for this user: clones it into ~/.apple-cua/app, runs its setup, and puts the `apple-cua`
# command into ~/.local/bin.
#
#   curl -fsSL https://raw.githubusercontent.com/trac3r00/apple-cua/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/trac3r00/apple-cua/main/install.sh | bash -s -- --add-to-path
#
# Options go to scripts/setup.sh: --add-to-path (append the line that puts ~/.local/bin on PATH to your shell
# startup file, backed up first), --register omo|claude|codex|json, --allow <apps>, --yes, ...
#
#   APPLE_CUA_HOME     where apple-cua keeps its state, and the checkout in app/ (default ~/.apple-cua)
#   APPLE_CUA_REPO     the git repository to clone (default https://github.com/trac3r00/apple-cua.git)
#   APPLE_CUA_REF      the branch, tag or commit to install (default main)
#   APPLE_CUA_BIN_DIR  where the apple-cua command goes (default ~/.local/bin)
#
# Running it again repairs the installation. `apple-cua update` updates it; `apple-cua uninstall` removes it.
set -Eeuo pipefail

readonly MIN_MACOS_MAJOR=15
cleanup_dir=""
trap '[[ -z "$cleanup_dir" ]] || rm -rf "$cleanup_dir"' EXIT

say() {
	printf '%s\n' "$*"
}

die() {
	printf '\ninstall.sh: %s\n' "$1" >&2
	if (($# > 1)); then
		printf '  fix: %s\n' "$2" >&2
	fi
	exit 1
}

json_string() {
	local value=$1
	value="${value//\\/\\\\}"
	value="${value//\"/\\\"}"
	printf '"%s"' "$value"
}

usage() {
	cat <<'EOF'
usage: curl -fsSL https://raw.githubusercontent.com/trac3r00/apple-cua/main/install.sh | bash [-s -- options]

Clones apple-cua into ~/.apple-cua/app (APPLE_CUA_HOME), runs its scripts/setup.sh, and installs the apple-cua
command into ~/.local/bin (APPLE_CUA_BIN_DIR). APPLE_CUA_REPO and APPLE_CUA_REF choose what to clone.

Options are passed to scripts/setup.sh, for example:
  --add-to-path         append the line that puts ~/.local/bin on PATH to your shell startup file (backed up first)
  --register <client>   register the MCP server with omo, claude, codex or json
  --allow <apps>        the apps agents may observe and drive, by name or bundle id (e.g. TextEdit)
  -y, --yes             do not ask; download Node.js when needed
EOF
}

main() {
	local argument
	for argument in "$@"; do
		if [[ "$argument" == -h || "$argument" == --help ]]; then
			usage
			return 0
		fi
	done
	local home="${APPLE_CUA_HOME:-$HOME/.apple-cua}"
	local repo="${APPLE_CUA_REPO:-https://github.com/trac3r00/apple-cua.git}"
	local ref="${APPLE_CUA_REF:-main}"
	if [[ "$home" != /* ]]; then
		home="$PWD/$home"
	fi
	local checkout="$home/app"

	[[ "$(uname -s)" == Darwin ]] || die "apple-cua runs on macOS only, and this is $(uname -s)"
	local version major
	version="${APPLE_CUA_MACOS_VERSION:-$(sw_vers -productVersion)}"
	major="${version%%.*}"
	if ! [[ "$major" =~ ^[0-9]+$ ]] || ((major < MIN_MACOS_MAJOR)); then
		die "apple-cua supports macOS 15 (Sequoia) and later, and this Mac runs macOS $version" \
			"update macOS in System Settings > General > Software Update, then run the installer again"
	fi
	# /usr/bin/git without the Command Line Tools only offers to install them, so check before using it.
	if ! xcode-select -p >/dev/null 2>&1; then
		die "the Xcode Command Line Tools are not installed (apple-cua needs their git and clang)" \
			"run: xcode-select --install   then run the installer again"
	fi

	if [[ -e "$checkout" ]]; then
		if [[ ! -f "$checkout/scripts/setup.sh" ]] || ! git -C "$checkout" rev-parse --git-dir >/dev/null 2>&1; then
			die "$checkout exists but is not an apple-cua checkout" \
				"move it away, or set APPLE_CUA_HOME to another directory"
		fi
		say "Using the existing checkout $checkout (apple-cua update updates it)."
	else
		say "Cloning $repo ($ref) into $checkout"
		mkdir -p "$home"
		cleanup_dir="$checkout.partial-$$"
		if ! git clone --quiet --branch "$ref" -- "$repo" "$cleanup_dir" 2>/dev/null; then
			rm -rf "$cleanup_dir"
			git clone --quiet -- "$repo" "$cleanup_dir" ||
				die "cannot clone $repo" "check the network and APPLE_CUA_REPO, then run the installer again"
			git -C "$cleanup_dir" checkout --quiet --detach "$ref" 2>/dev/null ||
				die "$repo has no branch, tag or commit named $ref" "check APPLE_CUA_REF"
		fi
		mv "$cleanup_dir" "$checkout"
		cleanup_dir=""
		# Marks the checkout as the installer's own, so `apple-cua uninstall` removes it and `update` follows $ref.
		printf '{\n\t"checkout": %s,\n\t"repo": %s,\n\t"ref": %s\n}\n' \
			"$(json_string "$checkout")" "$(json_string "$repo")" "$(json_string "$ref")" >"$home/install.json"
	fi

	if ! bash "$checkout/scripts/setup.sh" "$@"; then
		die "setup did not finish" \
			"fix what it reported above, then run the installer again (or $checkout/scripts/setup.sh)"
	fi
	say ""
	say "apple-cua is installed in $checkout; apple-cua uninstall removes it."
}

main "$@"
