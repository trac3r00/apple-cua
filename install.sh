#!/usr/bin/env bash
# Installs opencua for this user: clones it into ~/.opencua/app, runs its setup, and puts the `opencua`
# command into ~/.local/bin.
#
#   curl -fsSL https://raw.githubusercontent.com/trac3r00/opencua/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/trac3r00/opencua/main/install.sh | bash -s -- --add-to-path
#
# Options go to scripts/setup.sh: --add-to-path (append the line that puts ~/.local/bin on PATH to your shell
# startup file, backed up first), --register omo|claude|codex|gemini|cursor|hermes|openclaw|pi|json, --allow <apps>,
# --yes, ...
#
#   OPENCUA_HOME     where opencua keeps its state, and the checkout in app/ (default ~/.opencua)
#   OPENCUA_REPO     the git repository to clone (default https://github.com/trac3r00/opencua.git)
#   OPENCUA_REF      the branch, tag or commit to install (default main)
#   OPENCUA_BIN_DIR  where the opencua command goes (default ~/.local/bin)
#
# Running it again repairs the installation. `opencua update` updates it; `opencua uninstall` removes it.
set -Eeuo pipefail

for legacy in ${!APPLE_CUA_@}; do
	current="OPENCUA_${legacy#APPLE_CUA_}"
	if [[ -z "${!current+x}" ]]; then export "$current=${!legacy}"; fi
done

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
usage: curl -fsSL https://raw.githubusercontent.com/trac3r00/opencua/main/install.sh | bash [-s -- options]

Clones opencua into ~/.opencua/app (OPENCUA_HOME), runs its scripts/setup.sh, and installs the opencua
command into ~/.local/bin (OPENCUA_BIN_DIR). OPENCUA_REPO and OPENCUA_REF choose what to clone.

Options are passed to scripts/setup.sh, for example:
  --add-to-path         append the line that puts ~/.local/bin on PATH to your shell startup file (backed up first)
  --register <client>   register the MCP server with omo, claude, codex, gemini, cursor, hermes, openclaw, pi, or
                        json (prints a block to paste); repeatable or comma-separated
  --allow <apps>        optionally restrict agents to these apps, by name or bundle id (e.g. TextEdit)
  -y, --yes             do not ask; download Node.js when needed

See scripts/setup.sh --help for every option.
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
	local default_home="$HOME/.opencua"
	if [[ ! -e "$default_home" && -d "$HOME/.apple-cua" ]]; then default_home="$HOME/.apple-cua"; fi
	local home="${OPENCUA_HOME:-$default_home}"
	export OPENCUA_HOME="$home"
	local repo="${OPENCUA_REPO:-https://github.com/trac3r00/opencua.git}"
	local ref="${OPENCUA_REF:-main}"
	if [[ "$home" != /* ]]; then
		home="$PWD/$home"
	fi
	local checkout="$home/app"

	local host_os
	host_os="$(uname -s)"
	case "$host_os" in
		Darwin) ;;
		Linux)
			command -v git >/dev/null 2>&1 || die "git is required" \
				"apt: sudo apt-get install git; dnf: sudo dnf install git; pacman: sudo pacman -S git"
			;;
		*) die "unsupported OS $host_os; on Windows use scripts/install.ps1" ;;
	esac
	if [[ "$host_os" == Darwin ]]; then
	local version major
	version="${OPENCUA_MACOS_VERSION:-$(sw_vers -productVersion)}"
	major="${version%%.*}"
	if ! [[ "$major" =~ ^[0-9]+$ ]] || ((major < MIN_MACOS_MAJOR)); then
		die "opencua supports macOS 15 (Sequoia) and later, and this Mac runs macOS $version" \
			"update macOS in System Settings > General > Software Update, then run the installer again"
	fi
	# /usr/bin/git without the Command Line Tools only offers to install them, so check before using it.
	if ! xcode-select -p >/dev/null 2>&1; then
		die "the Xcode Command Line Tools are not installed (opencua needs their git and clang)" \
			"run: xcode-select --install   then run the installer again"
	fi
	fi

	if [[ -e "$checkout" ]]; then
		if [[ ! -f "$checkout/scripts/setup.sh" ]] || ! git -C "$checkout" rev-parse --git-dir >/dev/null 2>&1; then
			die "$checkout exists but is not an opencua checkout" \
				"move it away, or set OPENCUA_HOME to another directory"
		fi
		say "Using the existing checkout $checkout (opencua update updates it)."
	else
		say "Cloning $repo ($ref) into $checkout"
		mkdir -p "$home"
		cleanup_dir="$checkout.partial-$$"
		if ! git clone --quiet --branch "$ref" -- "$repo" "$cleanup_dir" 2>/dev/null; then
			rm -rf "$cleanup_dir"
			git clone --quiet -- "$repo" "$cleanup_dir" ||
				die "cannot clone $repo" "check the network and OPENCUA_REPO, then run the installer again"
			git -C "$cleanup_dir" checkout --quiet --detach "$ref" 2>/dev/null ||
				die "$repo has no branch, tag or commit named $ref" "check OPENCUA_REF"
		fi
		mv "$cleanup_dir" "$checkout"
		cleanup_dir=""
		# Marks the checkout as the installer's own, so `opencua uninstall` removes it and `update` follows $ref.
		printf '{\n\t"checkout": %s,\n\t"repo": %s,\n\t"ref": %s\n}\n' \
			"$(json_string "$checkout")" "$(json_string "$repo")" "$(json_string "$ref")" >"$home/install.json"
	fi

	if ! bash "$checkout/scripts/setup.sh" "$@"; then
		die "setup did not finish" \
			"fix what it reported above, then run the installer again (or $checkout/scripts/setup.sh)"
	fi
	say ""
	say "opencua is installed in $checkout; opencua uninstall removes it."
}

main "$@"
