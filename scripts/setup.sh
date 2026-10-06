#!/usr/bin/env bash
# One-command setup for apple-cua on any Mac with Apple Silicon or Intel and macOS 14 (Sonoma) or later.
#
#   ./scripts/setup.sh [--rebuild-native] [--rebuild-helper] [--register omo|claude|codex|json]...
#                      [--allow <bundle ids>] [--delivery background|attended] [--toolset lean|full] [--yes]
#
# Safe to re-run: every step checks before it acts, and a run after a failure picks up where the last one stopped.
# Outside this checkout it installs nothing, except the official Node.js LTS into ~/.apple-cua/node (checked against
# nodejs.org's SHASUMS256.txt) when this Mac has no Node.js 20+ or no self-contained node to bundle into the helper.
# It edits MCP client configs only for the clients named with --register, backing each file up first.
#
# The signed helper app ("apple-cua MCP") is built only when it is missing or fails its smoke run, or with
# --rebuild-helper: every build is a new code identity, and macOS then asks for Screen Recording and Accessibility
# again. Granting those two permissions is the one step left to do by hand; the closing doctor run says whether it is.
set -Eeuo pipefail

readonly MIN_MACOS="14.0"
readonly MIN_NODE_MAJOR=20
readonly TOTAL_STEPS=10

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly repo
readonly managed_node_dir="$HOME/.apple-cua/node"
readonly native_dir="$repo/packages/core/native"
readonly helper_app="$repo/packages/mcp/dist/apple-cua-mcp.app"
readonly helper_launcher="$helper_app/Contents/MacOS/apple-cua-mcp"
readonly helper_node="$helper_app/Contents/Resources/node"
readonly server_js="$repo/packages/mcp/dist/server.js"
readonly cli_js="$repo/packages/cli/dist/cli.js"

rebuild_native=0
rebuild_helper=0
assume_yes=0
registers=()
allow=""
allow_given=0
delivery=""
toolset=""
temp_dirs=()
current_step=0
current_title="starting"
used_managed_node=0

usage() {
	cat <<'EOF'
usage: ./scripts/setup.sh [options]

Installs, builds and checks apple-cua in this checkout. Safe to re-run.

  --rebuild-native        rebuild packages/core/native (default: use the committed universal binaries,
                          rebuilt only when their sources changed or a slice for this Mac is missing)
  --rebuild-helper        rebuild the signed helper app even if it works; macOS then asks for Screen
                          Recording and Accessibility again, because the rebuild is a new code identity
  --register <client>     register the MCP server with omo, claude, codex or json (prints a block);
                          repeatable or comma-separated; config files are backed up and merged
  --allow <bundle ids>    comma-separated apps the server may observe and drive, e.g. com.apple.TextEdit
  --delivery <mode>       background (default) or attended
  --toolset <profile>     full (default) or lean
  -y, --yes               do not ask; download Node.js when needed and keep an existing allow list
  -h, --help              show this help
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
		--rebuild-native) rebuild_native=1 ;;
		--rebuild-helper) rebuild_helper=1 ;;
		--register)
			(($# >= 2)) || usage_error "--register needs a client"
			add_registers "$2"
			shift
			;;
		--register=*) add_registers "${1#*=}" ;;
		--allow)
			(($# >= 2)) || usage_error "--allow needs a comma-separated list of bundle ids"
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

# Ask a yes/no question. With --yes, or without a terminal to ask on, the default answer is taken.
confirm() {
	local question=$1 default=${2:-y} answer prompt="[Y/n]"
	[[ "$default" == y ]] || prompt="[y/N]"
	if ((assume_yes)) || [[ ! -t 0 ]]; then
		[[ "$default" == y ]]
		return
	fi
	read -r -p "          $question $prompt " answer || answer=""
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
# that do not exist there. Same rule as scripts/build-tcc-helper.sh.
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

# The official Node.js LTS for this Mac's architecture in ~/.apple-cua/node, downloaded once and verified against
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
	/usr/bin/codesign -dvvv "$helper_app" 2>&1 | sed -n 's/^CDHash=/CDHash /p'
}

run_pnpm() {
	(cd "$repo" && "${pnpm_command[@]}" "$@")
}

# --- 1. macOS ----------------------------------------------------------------------------------------------------

step "macOS version and architecture"
[[ "$(uname -s)" == Darwin ]] || fail "apple-cua runs on macOS only, and this is $(uname -s)"
macos_version="$(sw_vers -productVersion)"
version_at_least "$macos_version" "$MIN_MACOS" ||
	fail "apple-cua needs macOS $MIN_MACOS (Sonoma) or later, and this Mac runs macOS $macos_version" \
		"update macOS in System Settings > General > Software Update, then re-run ./scripts/setup.sh"
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
	warn "this shell runs under Rosetta; setup still targets this Mac's native $host_arch"
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
	used_managed_node=1
	ok "$managed_node_dir/bin/node ($(node --version))"
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
	APPLE_CUA_NODE="$helper_node_source" "$repo/scripts/build-tcc-helper.sh" | sed 's/^/          /'
	if ! helper_problem="$(helper_smoke)"; then
		fail "the freshly built helper failed its smoke run: $helper_problem" \
			"re-run with --rebuild-helper; if it fails again, set APPLE_CUA_NODE to a node from https://nodejs.org"
	fi
	ok "built $helper_app ($(helper_identity)) bundling Node $("$helper_node" --version)"
fi

# --- 9. MCP client registration ----------------------------------------------------------------------------------

step "MCP client registration"
if ((${#registers[@]} == 0)); then
	ok "skipped: no --register given (no client configuration was read or changed)"
	if ((allow_given)) || [[ -n "$delivery$toolset" ]]; then
		warn "--allow, --delivery and --toolset only apply together with --register"
	fi
else
	if ((!allow_given && !assume_yes)) && [[ -t 0 ]]; then
		read -r -p "          Apps the server may observe and drive (comma-separated bundle ids, Enter keeps the current list): " answer || answer=""
		if [[ -n "$answer" ]]; then
			allow="$answer"
			allow_given=1
		fi
	fi
	register_arguments=("${registers[@]}")
	if ((allow_given)); then register_arguments+=(--allow "$allow"); fi
	if [[ -n "$delivery" ]]; then register_arguments+=(--delivery "$delivery"); fi
	if [[ -n "$toolset" ]]; then register_arguments+=(--toolset "$toolset"); fi
	node "$repo/scripts/register-mcp.mjs" "${register_arguments[@]}" ||
		fail "registration did not complete" "read the messages above; a config that failed was left untouched"
	ok "registered with: ${registers[*]}"
fi

# --- 10. Doctor --------------------------------------------------------------------------------------------------

step "doctor"
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

printf '\nMCP server for any client:\n'
printf '  command  %s\n' "$helper_launcher"
printf '  args     %s\n' "$server_js"
printf '  env      APPLE_CUA_ALLOWED_BUNDLE_IDS=<bundle ids it may drive>  (no app is approved without it)\n'
printf 'Register it later with: ./scripts/setup.sh --register <omo|claude|codex|json> --allow com.apple.TextEdit\n'
printf 'Re-check any time with: node %s doctor\n' "$cli_js"
if ((used_managed_node)); then
	# shellcheck disable=SC2016 # $PATH is printed literally, for the user to paste into a shell profile
	printf 'Node.js for the CLI is in %s; add it to PATH with: export PATH="%s/bin:$PATH"\n' \
		"$managed_node_dir" "$managed_node_dir"
fi

case "$doctor_verdict" in
	ready) printf '\napple-cua is set up and ready.\n' ;;
	manual)
		printf '\napple-cua is set up. One step is left to do by hand: grant the permissions the doctor lists above to\n'
		printf '"apple-cua MCP" in System Settings > Privacy & Security, then restart your MCP client.\n'
		;;
	*)
		fail "the doctor found problems beyond permissions" \
			"follow the numbered steps the doctor printed above, then re-run ./scripts/setup.sh"
		;;
esac
