#!/usr/bin/env bash
# One-command setup for apple-cua on a Mac with Apple Silicon or Intel and macOS 15 (Sequoia) or later.
#
#   ./scripts/setup.sh [--add-to-path] [--register omo|claude|codex|json]... [--allow <apps>]
#                      [--delivery background|attended] [--toolset lean|full] [--rebuild-native] [--rebuild-helper]
#                      [--yes] [--no-doctor]
#
# Safe to re-run: every step checks before it acts, and a run after a failure picks up where the last one stopped.
# Outside this checkout it writes only:
#   - the `apple-cua` command, into $APPLE_CUA_BIN_DIR (default ~/.local/bin);
#   - the official Node.js LTS, into $APPLE_CUA_HOME/node (default ~/.apple-cua/node, checked against nodejs.org's
#     SHASUMS256.txt), when this Mac has no Node.js 20+ or no self-contained node to bundle into the helper;
#   - with --add-to-path, one line in your shell startup file, backed up first;
#   - through `apple-cua config`, $APPLE_CUA_HOME/config.json and the configs of the MCP clients you register with
#     (backed up and merged; a client you never registered is not touched).
#
# The signed helper app ("apple-cua MCP") is built only when it is missing, fails its smoke run, was built from
# another launcher or Info.plist than this checkout has, or with --rebuild-helper: every build is a new code
# identity, and macOS then asks for Screen Recording and Accessibility again. Granting those two permissions is the
# one step left to do by hand; the closing doctor run says whether it is.
#
# APPLE_CUA_MACOS_VERSION pretends this Mac runs another macOS version; it exists to test the version check.
set -Eeuo pipefail

readonly MIN_MACOS="15.0"
readonly MIN_MACOS_NAME="Sequoia"
readonly MIN_NODE_MAJOR=20
readonly TOTAL_STEPS=11
readonly LAUNCHER_MARKER="# apple-cua-launcher checkout="
readonly PATH_LINE_MARKER="# added by apple-cua"

absolute() {
	case "$1" in
		/*) printf '%s\n' "$1" ;;
		*) printf '%s\n' "$PWD/$1" ;;
	esac
}

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
apple_cua_home="$(absolute "${APPLE_CUA_HOME:-$HOME/.apple-cua}")"
bin_dir="$(absolute "${APPLE_CUA_BIN_DIR:-$HOME/.local/bin}")"
readonly repo apple_cua_home bin_dir
export APPLE_CUA_HOME="$apple_cua_home" APPLE_CUA_BIN_DIR="$bin_dir"
readonly managed_node_dir="$apple_cua_home/node"
readonly launcher="$bin_dir/apple-cua"
readonly native_dir="$repo/packages/core/native"
readonly helper_app="$repo/packages/mcp/dist/apple-cua-mcp.app"
readonly helper_launcher="$helper_app/Contents/MacOS/apple-cua-mcp"
readonly helper_node="$helper_app/Contents/Resources/node"
readonly helper_stamp="$helper_app/Contents/Resources/helper-inputs.sha256"
readonly cli_js="$repo/packages/cli/dist/cli.js"

rebuild_native=0
rebuild_helper=0
assume_yes=0
add_path=0
run_doctor=1
registers=()
allow=""
allow_given=0
delivery=""
toolset=""
temp_dirs=()
current_step=0
current_title="starting"

usage() {
	cat <<'EOF'
usage: ./scripts/setup.sh [options]

Installs, builds and checks apple-cua in this checkout, and puts the apple-cua command in ~/.local/bin
(APPLE_CUA_BIN_DIR). Safe to re-run.

  --add-to-path           append the line that puts ~/.local/bin on PATH to your shell startup file (backed up first)
  --register <client>     register the MCP server with omo, claude, codex or json (prints a block); repeatable or
                          comma-separated; shortcut for: apple-cua config --register <client>
  --allow <apps>          the apps the server may observe and drive, by name or bundle id (e.g. TextEdit); replaces
                          the saved list
  --delivery <mode>       background (default) or attended
  --toolset <profile>     full (default) or lean
  --rebuild-native        rebuild packages/core/native (default: use the committed universal binaries, rebuilt only
                          when their sources changed or a slice for this Mac is missing)
  --rebuild-helper        rebuild the signed helper app even if it works; macOS then asks for Screen Recording and
                          Accessibility again, because the rebuild is a new code identity
  -y, --yes               do not ask; download Node.js when needed
  --no-doctor             skip the closing doctor run
  -h, --help              show this help

Afterwards: apple-cua config (apps and MCP clients), apple-cua doctor [--fix], apple-cua update, apple-cua uninstall.
EOF
}

usage_error() {
	printf 'setup.sh: %s\n\n' "$1" >&2
	usage >&2
	exit 2
}

add_registers() {
	local client
	local -a clients
	IFS=, read -r -a clients <<<"$1"
	for client in ${clients[@]+"${clients[@]}"}; do
		case "$client" in
			omo | claude | codex | json) registers+=("$client") ;;
			*) usage_error "unknown --register client '$client' (expected omo, claude, codex or json)" ;;
		esac
	done
}

while (($# > 0)); do
	case "$1" in
		--add-to-path) add_path=1 ;;
		--rebuild-native) rebuild_native=1 ;;
		--rebuild-helper) rebuild_helper=1 ;;
		--no-doctor) run_doctor=0 ;;
		--register)
			(($# >= 2)) || usage_error "--register needs a client"
			add_registers "$2"
			shift
			;;
		--register=*) add_registers "${1#*=}" ;;
		--allow)
			(($# >= 2)) || usage_error "--allow needs a comma-separated list of apps"
			allow="$2"
			allow_given=1
			shift
			;;
		--allow=*)
			allow="${1#*=}"
			allow_given=1
			;;
		--delivery | --delivery=*)
			if [[ "$1" == *=* ]]; then delivery="${1#*=}"; else
				(($# >= 2)) || usage_error "--delivery needs background or attended"
				delivery="$2"
				shift
			fi
			[[ "$delivery" == background || "$delivery" == attended ]] || usage_error "--delivery must be background or attended"
			;;
		--toolset | --toolset=*)
			if [[ "$1" == *=* ]]; then toolset="${1#*=}"; else
				(($# >= 2)) || usage_error "--toolset needs lean or full"
				toolset="$2"
				shift
			fi
			[[ "$toolset" == lean || "$toolset" == full ]] || usage_error "--toolset must be lean or full"
			;;
		-y | --yes) assume_yes=1 ;;
		-h | --help)
			usage
			exit 0
			;;
		*) usage_error "unknown option: $1" ;;
	esac
	shift
done

# --- Output and failure handling ---------------------------------------------------------------------------------

step() {
	current_step=$((current_step + 1))
	current_title="$1"
	printf '\n[%d/%d] %s\n' "$current_step" "$TOTAL_STEPS" "$1"
}
ok() { printf '      ok  %s\n' "$*"; }
info() { printf '          %s\n' "$*"; }
warn() { printf '    warn  %s\n' "$*"; }

fail() {
	printf '\nsetup failed at step %d/%d (%s): %s\n' "$current_step" "$TOTAL_STEPS" "$current_title" "$1" >&2
	if (($# > 1)); then
		printf '  fix: %s\n' "$2" >&2
	fi
	exit 1
}

on_error() {
	local status=$1 line=$2 command=$3
	# shellcheck disable=SC2016 # the backticks are literal: they quote the failed command in the message
	printf '\nsetup failed at step %d/%d (%s): `%s` exited with status %d (setup.sh line %d)\n' \
		"$current_step" "$TOTAL_STEPS" "$current_title" "$command" "$status" "$line" >&2
	printf '  fix: read the output above, fix the cause, then re-run ./scripts/setup.sh; finished steps are skipped\n' >&2
	exit "$status"
}
trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

cleanup() {
	local dir
	for dir in ${temp_dirs[@]+"${temp_dirs[@]}"}; do
		rm -rf "$dir"
	done
}
trap cleanup EXIT

# Ask a yes/no question. Under `curl ... | bash` stdin is the download, so the question goes to the terminal itself
# (/dev/tty), the way Homebrew's and rustup's installers ask. With --yes, or with no terminal at all (CI), the default
# answer is taken.
confirm() {
	local question=$1 default=${2:-y} answer="" prompt="[Y/n]"
	[[ "$default" == y ]] || prompt="[y/N]"
	if ((assume_yes)); then
		[[ "$default" == y ]]
		return
	fi
	if [[ -t 0 ]]; then
		read -r -p "          $question $prompt " answer || answer=""
	elif (: </dev/tty) 2>/dev/null; then
		printf '          %s %s ' "$question" "$prompt" >/dev/tty
		read -r answer </dev/tty || answer=""
	else
		[[ "$default" == y ]]
		return
	fi
	answer="${answer:-$default}"
	[[ "$answer" == [Yy]* ]]
}

version_at_least() {
	local -a have want
	local index count
	IFS=. read -r -a have <<<"$1"
	IFS=. read -r -a want <<<"$2"
	count=${#want[@]}
	((${#have[@]} > count)) && count=${#have[@]}
	for ((index = 0; index < count; index++)); do
		local left="${have[index]:-0}" right="${want[index]:-0}"
		[[ "$left" =~ ^[0-9]+$ && "$right" =~ ^[0-9]+$ ]] || return 1
		if ((10#$left > 10#$right)); then return 0; fi
		if ((10#$left < 10#$right)); then return 1; fi
	done
	return 0
}

# --- Node.js helpers ---------------------------------------------------------------------------------------------

node_is_usable() {
	local major
	major="$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
	[[ "$major" =~ ^[0-9]+$ ]] && ((major >= MIN_NODE_MAJOR))
}

# Only a self-contained node can be copied into the helper bundle: Homebrew's links libnode.dylib and Cellar paths
# (/opt/homebrew on Apple Silicon, /usr/local on Intel) that do not exist there. Same rule as build-tcc-helper.sh.
node_is_self_contained() {
	local dependencies
	dependencies="$(otool -L "$1" 2>/dev/null)" || return 1
	[[ -n "$dependencies" ]] || return 1
	! grep -Eq 'libnode|/opt/homebrew|/usr/local/(opt|Cellar)' <<<"$dependencies"
}

node_is_bundleable() {
	node_is_usable "$1" && node_is_self_contained "$1" && [[ "$("$1" -p process.arch 2>/dev/null)" == "$node_platform_arch" ]]
}

bundle_refusal() {
	if ! node_is_usable "$1"; then
		echo "it does not run or is older than Node $MIN_NODE_MAJOR"
	elif ! node_is_self_contained "$1"; then
		echo "it links shared libraries (libnode.dylib or Homebrew paths), so it cannot live inside the app bundle"
	else
		echo "it is built for $("$1" -p process.arch 2>/dev/null || echo unknown) and this Mac needs $node_platform_arch"
	fi
}

# The official Node.js LTS for this Mac's architecture in $APPLE_CUA_HOME/node, downloaded once and verified against
# SHASUMS256.txt. Its bin/node is self-contained, so it can also be bundled into the helper.
ensure_managed_node() {
	if [[ -x "$managed_node_dir/bin/node" ]] && node_is_usable "$managed_node_dir/bin/node"; then
		info "reusing $managed_node_dir ($("$managed_node_dir/bin/node" --version))"
		return 0
	fi
	confirm "Download the official Node.js LTS for darwin-$node_platform_arch from nodejs.org into $managed_node_dir?" y ||
		fail "a Node.js download was declined" \
			"install Node.js $MIN_NODE_MAJOR+ from https://nodejs.org (the macOS installer), or re-run with --yes"
	local index version tarball base tmp expected actual
	index="$(curl -fsSL --retry 2 https://nodejs.org/dist/index.tab)" ||
		fail "cannot reach nodejs.org to look up the current Node.js LTS" \
			"check the network, or install Node.js $MIN_NODE_MAJOR+ yourself and re-run"
	version="$(awk -F'\t' -v want="osx-$node_platform_arch-tar" \
		'NR > 1 && $10 != "-" && index($3, want) > 0 { print $1; exit }' <<<"$index")"
	[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
		fail "nodejs.org/dist/index.tab lists no LTS release for darwin-$node_platform_arch" \
			"install Node.js $MIN_NODE_MAJOR+ yourself and re-run"
	tarball="node-$version-darwin-$node_platform_arch.tar.gz"
	base="https://nodejs.org/dist/$version"
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/apple-cua-node.XXXXXX")"
	temp_dirs+=("$tmp")
	info "downloading $base/$tarball"
	curl -fsSL --retry 2 -o "$tmp/$tarball" "$base/$tarball" ||
		fail "downloading $tarball failed" "check the network and re-run"
	curl -fsSL --retry 2 -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt" ||
		fail "downloading SHASUMS256.txt for $version failed" "check the network and re-run"
	expected="$(awk -v file="$tarball" '$2 == file { print $1 }' "$tmp/SHASUMS256.txt")"
	actual="$(shasum -a 256 "$tmp/$tarball" | awk '{ print $1 }')"
	[[ -n "$expected" && "$expected" == "$actual" ]] ||
		fail "$tarball does not match nodejs.org's SHASUMS256.txt (expected ${expected:-no entry}, got $actual)" \
			"re-run to download it again; if it keeps failing, install Node.js yourself"
	info "sha256 $actual matches SHASUMS256.txt"
	tar -xzf "$tmp/$tarball" -C "$tmp"
	mkdir -p "$(dirname "$managed_node_dir")"
	rm -rf "$managed_node_dir.partial"
	mv "$tmp/node-$version-darwin-$node_platform_arch" "$managed_node_dir.partial"
	rm -rf "$managed_node_dir"
	mv "$managed_node_dir.partial" "$managed_node_dir"
	node_is_usable "$managed_node_dir/bin/node" ||
		fail "the downloaded Node.js $version does not run on macOS $macos_version" \
			"install a Node.js $MIN_NODE_MAJOR+ build that supports this macOS from https://nodejs.org"
	info "installed Node.js $version in $managed_node_dir"
}

# Sets helper_node_source to a self-contained Node.js 20+ for this architecture: APPLE_CUA_NODE when set, else the
# first one on PATH, else the managed download.
select_helper_node() {
	helper_node_source=""
	local candidate real seen=" "
	if [[ -n "${APPLE_CUA_NODE:-}" ]]; then
		real="$("$APPLE_CUA_NODE" -p process.execPath 2>/dev/null)" || fail "APPLE_CUA_NODE=$APPLE_CUA_NODE does not run"
		node_is_bundleable "$real" ||
			fail "APPLE_CUA_NODE=$APPLE_CUA_NODE cannot be bundled: $(bundle_refusal "$real")" \
				"point APPLE_CUA_NODE at the node of the official nodejs.org tarball or installer, or unset it"
		helper_node_source="$real"
		return 0
	fi
	while IFS= read -r candidate; do
		[[ -n "$candidate" ]] || continue
		real="$("$candidate" -p process.execPath 2>/dev/null)" || continue
		[[ "$seen" == *" $real "* ]] && continue
		seen="$seen$real "
		if node_is_bundleable "$real"; then
			helper_node_source="$real"
			info "bundling the self-contained node at $real ($("$real" --version))"
			return 0
		fi
		info "not bundling $real: $(bundle_refusal "$real")"
	done < <(
		type -ap node 2>/dev/null || true
		if [[ -x "$managed_node_dir/bin/node" ]]; then printf '%s\n' "$managed_node_dir/bin/node"; fi
	)
	info "no self-contained node on PATH, so the helper gets the official Node.js LTS"
	ensure_managed_node
	real="$("$managed_node_dir/bin/node" -p process.execPath)"
	node_is_bundleable "$real" || fail "the node in $managed_node_dir cannot be bundled: $(bundle_refusal "$real")"
	helper_node_source="$real"
}

# --- Helper app ---------------------------------------------------------------------------------------------------

# Exits 0 when the helper is intact: launcher and bundled node present, the bundle signature verifies, the bundled
# node is 20+, and the launcher runs a script through it. Prints why otherwise.
helper_smoke() {
	if [[ ! -x "$helper_launcher" || ! -x "$helper_node" ]]; then
		echo "its launcher or bundled node is missing"
		return 1
	fi
	local output
	if ! output="$(/usr/bin/codesign --verify --deep --strict "$helper_app" 2>&1)"; then
		echo "codesign --verify failed: $output"
		return 1
	fi
	if ! node_is_usable "$helper_node"; then
		echo "its bundled node does not run or is older than Node $MIN_NODE_MAJOR"
		return 1
	fi
	if ! output="$("$helper_launcher" -e 'process.stdout.write("ok")' 2>&1)" || [[ "$output" != "ok" ]]; then
		echo "the launcher did not run a script through its node: ${output:-no output}"
		return 1
	fi
}

helper_identity() {
	local details
	details="$(/usr/bin/codesign -dvvv "$helper_app" 2>&1 || true)"
	printf '%s, CDHash %s' "$(sed -n 's/^Identifier=//p' <<<"$details")" "$(sed -n 's/^CDHash=//p' <<<"$details")"
}

run_pnpm() {
	(cd "$repo" && "${pnpm_command[@]}" "$@")
}

# --- The apple-cua command ----------------------------------------------------------------------------------------

# A launcher that runs this checkout's CLI with the node setup used, and with the APPLE_CUA_HOME and
# APPLE_CUA_BIN_DIR of this setup unless the caller sets them. Its second line names the checkout, which is how
# `apple-cua uninstall` and later setups recognise it.
write_launcher() {
	local q_home q_bin q_node q_cli q_setup
	q_home="$(printf '%q' "$apple_cua_home")"
	q_bin="$(printf '%q' "$bin_dir")"
	q_node="$(printf '%q' "$1")"
	q_cli="$(printf '%q' "$cli_js")"
	q_setup="$(printf '%q' "$repo/scripts/setup.sh")"
	cat <<LAUNCHER
#!/bin/bash
$LAUNCHER_MARKER$repo
# The apple-cua command, written by the setup of that checkout; \`apple-cua uninstall\` removes it.
if [[ -z "\${APPLE_CUA_HOME:-}" ]]; then export APPLE_CUA_HOME=$q_home; fi
if [[ -z "\${APPLE_CUA_BIN_DIR:-}" ]]; then export APPLE_CUA_BIN_DIR=$q_bin; fi
node=$q_node
if [[ ! -x "\$node" ]]; then node="\$(command -v node || true)"; fi
if [[ -z "\$node" ]]; then
	setup=$q_setup
	echo "apple-cua: found no node to run with; re-run \$setup" >&2
	exit 1
fi
exec "\$node" $q_cli "\$@"
LAUNCHER
}

shell_rc_file() {
	case "$(basename "${SHELL:-/bin/zsh}")" in
		zsh) printf '%s\n' "${ZDOTDIR:-$HOME}/.zshrc" ;;
		bash) printf '%s\n' "$HOME/.bash_profile" ;;
		fish) printf '%s\n' "$HOME/.config/fish/config.fish" ;;
		*) printf '%s\n' "$HOME/.profile" ;;
	esac
}

# The line that puts bin_dir on PATH, in the syntax of the startup file it goes into. $HOME and $PATH are written
# literally, for the shell to expand when it starts.
# shellcheck disable=SC2016
path_line() {
	local dir=$bin_dir
	if [[ "$dir" == "$HOME"/* ]]; then dir='$HOME'"${dir#"$HOME"}"; fi
	if [[ "$1" == *.fish ]]; then
		printf 'set -gx PATH "%s" $PATH %s\n' "$dir" "$PATH_LINE_MARKER"
	else
		printf 'export PATH="%s:$PATH" %s\n' "$dir" "$PATH_LINE_MARKER"
	fi
}

add_to_path() {
	local rc line backup=""
	rc="$(shell_rc_file)"
	line="$(path_line "$rc")"
	if [[ -f "$rc" ]] && grep -qF "$PATH_LINE_MARKER" "$rc"; then
		ok "$rc already puts $bin_dir on PATH"
		return 0
	fi
	mkdir -p "$(dirname "$rc")"
	if [[ -f "$rc" ]]; then
		backup="$rc.bak-$(date +%Y%m%d-%H%M%S)"
		[[ ! -e "$backup" ]] || backup="$backup-$$"
		cp -p "$rc" "$backup"
		if [[ -s "$rc" && -n "$(tail -c 1 "$rc")" ]]; then printf '\n' >>"$rc"; fi
	fi
	printf '%s\n' "$line" >>"$rc"
	ok "added $bin_dir to PATH in $rc${backup:+ (backup: $backup)}"
	info "new terminals find apple-cua; in this one run: ${line% "$PATH_LINE_MARKER"}"
}

# --- 1. macOS ----------------------------------------------------------------------------------------------------

step "macOS version and architecture"
[[ "$(uname -s)" == Darwin ]] || fail "apple-cua runs on macOS only, and this is $(uname -s)"
macos_version="${APPLE_CUA_MACOS_VERSION:-$(sw_vers -productVersion)}"
version_at_least "$macos_version" "$MIN_MACOS" ||
	fail "apple-cua supports macOS $MIN_MACOS ($MIN_MACOS_NAME) and later, and this Mac runs macOS $macos_version" \
		"update macOS in System Settings > General > Software Update, then re-run ./scripts/setup.sh"
# hw.optional.arm64 names the CPU even for a process under Rosetta, where uname -m says x86_64.
if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" == 1 ]]; then
	host_arch=arm64
	node_platform_arch=arm64
	machine="Apple Silicon"
else
	host_arch=x86_64
	node_platform_arch=x64
	machine=Intel
fi
if [[ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" == 1 ]]; then
	warn "this shell runs under Rosetta; setup still builds for this Mac's native $host_arch"
fi
ok "macOS $macos_version on $machine ($host_arch)"

# --- 2. Command Line Tools ---------------------------------------------------------------------------------------

step "Xcode Command Line Tools"
developer_dir="$(xcode-select -p 2>/dev/null || true)"
[[ -n "$developer_dir" && -d "$developer_dir" ]] ||
	fail "the Xcode Command Line Tools are not installed" "run: xcode-select --install   then re-run ./scripts/setup.sh"
for tool in clang otool lipo; do
	xcrun --find "$tool" >/dev/null 2>&1 ||
		fail "$tool is missing from $developer_dir" "run: xcode-select --install   (or sudo xcode-select --reset)"
done
[[ -x /usr/bin/codesign ]] || fail "/usr/bin/codesign is missing" "reinstall the Command Line Tools: xcode-select --install"
clang --version >/dev/null 2>&1 ||
	fail "clang does not run, which usually means the Xcode license is not accepted yet" "run: sudo xcodebuild -license accept"
ok "$(clang --version 2>/dev/null | sed -n 1p) in $developer_dir"

# --- 3. Node.js --------------------------------------------------------------------------------------------------

step "Node.js $MIN_NODE_MAJOR or later"
build_node="$(command -v node 2>/dev/null || true)"
if [[ -n "$build_node" ]] && node_is_usable "$build_node"; then
	ok "$build_node ($("$build_node" --version))"
else
	if [[ -n "$build_node" ]]; then
		warn "$build_node is $("$build_node" --version 2>/dev/null || echo 'not runnable'), older than Node $MIN_NODE_MAJOR"
	else
		info "no node on PATH"
	fi
	ensure_managed_node
	export PATH="$managed_node_dir/bin:$PATH"
	build_node="$managed_node_dir/bin/node"
	ok "$build_node ($(node --version))"
fi
if [[ "$("$build_node" -p process.arch 2>/dev/null || true)" != "$node_platform_arch" ]]; then
	warn "$build_node is an Intel (x64) build running under Rosetta; install the native $node_platform_arch Node.js from https://nodejs.org for full speed"
fi

# --- 4. pnpm -----------------------------------------------------------------------------------------------------

step "pnpm"
pnpm_version="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$repo/package.json")"
[[ -n "$pnpm_version" ]] || fail "package.json names no pnpm version in packageManager"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if command -v pnpm >/dev/null 2>&1 && [[ "$(cd "$repo" && pnpm --version 2>/dev/null | tail -n 1)" == "$pnpm_version" ]]; then
	pnpm_command=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
	pnpm_command=(corepack "pnpm@$pnpm_version")
elif command -v npx >/dev/null 2>&1; then
	pnpm_command=(npx --yes "pnpm@$pnpm_version")
else
	fail "neither pnpm $pnpm_version, corepack nor npx is available" "install pnpm: npm install -g pnpm@$pnpm_version"
fi
pnpm_found="$(cd "$repo" && "${pnpm_command[@]}" --version 2>/dev/null | tail -n 1)" || pnpm_found=""
[[ "$pnpm_found" == "$pnpm_version" ]] ||
	fail "\`${pnpm_command[*]} --version\` printed '${pnpm_found:-nothing}' instead of $pnpm_version" \
		"install pnpm $pnpm_version (npm install -g pnpm@$pnpm_version) and re-run"
ok "pnpm $pnpm_version via ${pnpm_command[*]} (the version package.json pins)"

# --- 5. Dependencies ---------------------------------------------------------------------------------------------

step "dependencies (pnpm install --frozen-lockfile)"
run_pnpm install --frozen-lockfile
ok "node_modules matches pnpm-lock.yaml"

# --- 6. Native binaries ------------------------------------------------------------------------------------------

step "native binaries (universal arm64 + x86_64)"
native_reason=""
if ((rebuild_native)); then
	native_reason="--rebuild-native was given"
else
	for binary in libsckit.dylib cursor-overlay; do
		if [[ ! -f "$native_dir/$binary" ]]; then
			native_reason="$binary is missing"
			break
		fi
		if ! lipo "$native_dir/$binary" -verify_arch "$host_arch" >/dev/null 2>&1; then
			native_reason="$binary has no $host_arch slice"
			break
		fi
	done
	if [[ -z "$native_reason" ]] && ! (cd "$native_dir" && shasum -a 256 -c --status build-inputs.sha256 >/dev/null 2>&1); then
		native_reason="their sources changed since they were built (build-inputs.sha256 does not match)"
	fi
fi
if [[ -n "$native_reason" ]]; then
	info "building because $native_reason"
	"$native_dir/build.sh"
fi
ok "libsckit.dylib ($(lipo -archs "$native_dir/libsckit.dylib")), cursor-overlay ($(lipo -archs "$native_dir/cursor-overlay"))${native_reason:+, rebuilt}"

# --- 7. TypeScript -----------------------------------------------------------------------------------------------

step "TypeScript build"
run_pnpm --filter @apple-cua/core run build:ts
run_pnpm --filter @apple-cua/mcp --filter @apple-cua/cli --filter @apple-cua/pi-extension --filter @apple-cua/agent run build
ok "built core, mcp, cli, pi-extension and agent"

# --- 8. Signed helper app ----------------------------------------------------------------------------------------

step "signed helper app (\"apple-cua MCP\")"
helper_reason=""
if ((rebuild_helper)); then
	helper_reason="--rebuild-helper was given"
elif [[ ! -d "$helper_app" ]]; then
	helper_reason="it does not exist yet"
elif ! helper_problem="$(helper_smoke)"; then
	helper_reason="its smoke run failed: $helper_problem"
elif [[ -f "$helper_stamp" && "$(<"$helper_stamp")" != "$(bash "$repo/scripts/build-tcc-helper.sh" --inputs-digest)" ]]; then
	helper_reason="this checkout has another launcher or Info.plist than the one it was built from"
fi
if [[ -z "$helper_reason" ]]; then
	ok "kept $helper_app ($(helper_identity)), so its permission grants still apply"
else
	if [[ -d "$helper_app" ]]; then
		warn "rebuilding the helper because $helper_reason"
		warn "the rebuild is a new code identity: macOS will ask again for Screen Recording and Accessibility"
	else
		info "building it because $helper_reason"
	fi
	select_helper_node
	APPLE_CUA_NODE="$helper_node_source" "$repo/scripts/build-tcc-helper.sh" 2>&1 | sed 's/^/          /'
	if ! helper_problem="$(helper_smoke)"; then
		fail "the freshly built helper failed its smoke run: $helper_problem" \
			"re-run with --rebuild-helper; if it fails again, set APPLE_CUA_NODE to a node from https://nodejs.org"
	fi
	ok "built $helper_app ($(helper_identity)) bundling Node $("$helper_node" --version)"
fi

# --- 9. The apple-cua command ------------------------------------------------------------------------------------

step "the apple-cua command"
cua="node $cli_js"
if [[ (-e "$launcher" || -L "$launcher") && "$(sed -n 2p "$launcher" 2>/dev/null || true)" != "$LAUNCHER_MARKER"* ]]; then
	warn "$launcher exists and was not written by apple-cua setup, so it was left as it is"
	info "remove it and re-run setup to get the apple-cua command; until then run: $cua <command>"
else
	previous="$(sed -n "2s/^$LAUNCHER_MARKER//p" "$launcher" 2>/dev/null || true)"
	mkdir -p "$bin_dir"
	write_launcher "$build_node" >"$launcher.tmp-$$"
	chmod 755 "$launcher.tmp-$$"
	mv -f "$launcher.tmp-$$" "$launcher"
	if [[ -n "$previous" && "$previous" != "$repo" ]]; then
		ok "$launcher now runs this checkout (it ran $previous before)"
	else
		ok "$launcher runs this checkout"
	fi
	cua="$launcher"
	case ":$PATH:" in
		*":$bin_dir:"*)
			ok "$bin_dir is on PATH"
			cua="apple-cua"
			;;
		*)
			if ((add_path)); then
				add_to_path
				cua="apple-cua"
			else
				warn "$bin_dir is not on PATH, so a new terminal does not find apple-cua yet"
				info "add it with: $repo/scripts/setup.sh --add-to-path   (appends this line to $(shell_rc_file), backed up first)"
				info "  $(path_line "$(shell_rc_file)")"
			fi
			;;
	esac
fi

# --- 10. MCP client registration ---------------------------------------------------------------------------------

step "MCP client registration"
config_arguments=()
for client in ${registers[@]+"${registers[@]}"}; do
	config_arguments+=(--register "$client")
done
if ((allow_given)); then config_arguments+=(--disallow all --allow "$allow"); fi
if [[ -n "$delivery" ]]; then config_arguments+=(--delivery "$delivery"); fi
if [[ -n "$toolset" ]]; then config_arguments+=(--toolset "$toolset"); fi
if ((${#config_arguments[@]} == 0)); then config_arguments=(--apply); fi
if ! node "$cli_js" config "${config_arguments[@]}" 2>&1 | sed 's/^/          /'; then
	fail "the MCP client registration did not complete" \
		"read the messages above, then run: $cua config; a config file that could not be read was left untouched"
fi
ok "apple-cua config ${config_arguments[*]}"

# --- 11. Doctor --------------------------------------------------------------------------------------------------

step "doctor"
if ((!run_doctor)); then
	ok "skipped: --no-doctor was given"
	printf '\napple-cua is set up in %s.\n' "$repo"
	exit 0
fi
doctor_verdict=ready
if ! node "$cli_js" doctor; then
	# The doctor exits 1 whenever it is not ready; its JSON says whether only the manual permission grants are left.
	doctor_report="$(node "$cli_js" --json doctor 2>/dev/null || true)"
	if node -e '
		try { process.exit(JSON.parse(process.argv[1]).onlyManualStepsRemain === true ? 0 : 1); } catch { process.exit(1); }' \
		"$doctor_report"; then
		doctor_verdict=manual
	else
		doctor_verdict=blocked
	fi
fi

printf '\nNext:\n'
printf '  %-28s %s\n' "$cua config" "choose the apps agents may use and the MCP clients to register with" \
	"$cua doctor --fix" "check the installation and repair what is safe to repair" \
	"$cua update" "update this checkout and everything setup built" \
	"$cua uninstall" "remove apple-cua again"

case "$doctor_verdict" in
	ready) printf '\napple-cua is set up and ready.\n' ;;
	manual)
		printf '\napple-cua is set up. One step is left to do by hand: grant the permissions the doctor lists above to\n'
		printf '"apple-cua MCP" in System Settings > Privacy & Security, then restart your MCP client.\n'
		;;
	*)
		fail "the doctor found problems beyond permissions" \
			"follow the numbered steps the doctor printed above (apple-cua doctor --fix repairs most), then re-run ./scripts/setup.sh"
		;;
esac
