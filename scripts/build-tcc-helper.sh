#!/usr/bin/env bash
# Builds the signed TCC helper app for the apple-cua MCP server.
#
#   scripts/build-tcc-helper.sh [<output dir>]    build <output dir>/apple-cua-mcp.app (default: packages/mcp/dist)
#   scripts/build-tcc-helper.sh --inputs-digest   print the digest of the inputs a build would use, and exit
#
# macOS attributes Screen Recording and Accessibility to the process that asks, and an
# identity-less process is attributed to whatever launched it. This bundle gives the server its
# own identity: a small launcher is the bundle's executable, and it spawns the bundled Node with
# responsibility disclaimed, so the server's asks name the bundle (dev.applecua.mcp by default)
# instead of the host. APPLE_CUA_BUNDLE_ID sets another bundle id; without it a rebuild keeps the
# id of the helper it replaces.
#
# Note for rebuilds: with ad-hoc signing (the default) the code identity changes on every build,
# so macOS treats a rebuilt bundle as a new app and asks for Screen Recording and Accessibility
# again. Set APPLE_CUA_SIGN_IDENTITY to a stable certificate to keep one identity across builds.
# Every build records the digest of its inputs (the launcher source and flags, Info.plist and the
# bundle id, but not the version or the bundled Node) in Contents/Resources/helper-inputs.sha256,
# so setup and the doctor ask for a rebuild only when one of those changed.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
print_digest=0
out_dir="$repo/packages/mcp/dist"
case "${1:-}" in
	--inputs-digest) print_digest=1 ;;
	"") ;;
	*) out_dir="$1" ;;
esac
app="$out_dir/apple-cua-mcp.app"
executable="apple-cua-mcp"
server="$repo/packages/mcp/dist/server.js"
launcher_source="$repo/scripts/tcc-helper-launcher.c"
icon_source="$repo/packages/mcp/assets/appicon.png"
node_bin="${APPLE_CUA_NODE:-}"
sign_identity="${APPLE_CUA_SIGN_IDENTITY:--}"
minimum_macos="15.0"
stamp="Contents/Resources/helper-inputs.sha256"

if [[ -n "${APPLE_CUA_BUNDLE_ID:-}" ]]; then
	bundle_id="$APPLE_CUA_BUNDLE_ID"
else
	bundle_id="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$app/Contents/Info.plist" 2>/dev/null || true)"
	bundle_id="${bundle_id:-dev.applecua.mcp}"
fi
# This Mac's CPU, also from a shell that runs under Rosetta, where uname -m says x86_64.
if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" == 1 ]]; then
	host_arch=arm64
	node_arch=arm64
else
	host_arch=x86_64
	node_arch=x64
fi
launcher_flags=(-O2 -Wall -arch "$host_arch" "-mmacosx-version-min=$minimum_macos")

# Info.plist of a helper with version $1.
info_plist() {
	cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleDisplayName</key>
	<string>apple-cua MCP</string>
	<key>CFBundleExecutable</key>
	<string>$executable</string>
	<key>CFBundleIdentifier</key>
	<string>$bundle_id</string>
	<key>CFBundleIconFile</key>
	<string>appicon</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>apple-cua MCP</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>$1</string>
	<key>CFBundleVersion</key>
	<string>$1</string>
	<key>LSMinimumSystemVersion</key>
	<string>$minimum_macos</string>
	<key>NSAppleEventsUsageDescription</key>
	<string>apple-cua drives the apps and the iPhone Mirroring window you approve.</string>
</dict>
</plist>
PLIST
}

# What makes up the helper's code identity, without the version: each rebuild costs the person both permission
# grants, so a release that changes none of these keeps the helper.
inputs_digest() {
	{
		printf 'launcher %s\n' "$(shasum -a 256 <"$launcher_source" | awk '{ print $1 }')"
		printf 'launcher-flags %s\n' "${launcher_flags[*]}"
		info_plist "(any version)"
	} | shasum -a 256 | awk '{ print $1 }'
}

if ((print_digest)); then
	inputs_digest
	exit 0
fi

# Only a self-contained Node can live inside the bundle: Homebrew's build links libnode.dylib and
# Cellar paths (/opt/homebrew on Apple Silicon, /usr/local on Intel) that do not exist there, so
# copying it produces a bundle whose launcher dies with "Library not loaded" at runtime. It must
# also be built for this Mac's CPU, or the helper runs under Rosetta (or, without Rosetta, not at
# all). Prefer APPLE_CUA_NODE, then the first such node on PATH and in the usual local installs,
# and refuse loudly instead of shipping a broken bundle.
bundled_node_is_self_contained() {
	local dependencies
	dependencies="$(otool -L "$1" 2>/dev/null || true)"
	[[ -n "$dependencies" ]] || return 1
	! grep -Eq 'libnode|/opt/homebrew|/usr/local/(opt|Cellar)' <<<"$dependencies"
}

arch_of_node() {
	"$1" -p process.arch 2>/dev/null || echo "an unknown CPU"
}

resolve_node_bin() {
	if [[ -n "$node_bin" ]]; then
		printf '%s\n' "$node_bin"
		return 0
	fi
	local candidate
	while IFS= read -r candidate; do
		[[ -n "$candidate" && -x "$candidate" ]] || continue
		if bundled_node_is_self_contained "$candidate" && [[ "$(arch_of_node "$candidate")" == "$node_arch" ]]; then
			printf '%s\n' "$candidate"
			return 0
		fi
	done < <(
		which -a node 2>/dev/null || true
		printf '%s\n' "$HOME/.local/bin/node" /usr/local/bin/node "${APPLE_CUA_HOME:-$HOME/.apple-cua}/node/bin/node"
	)
	return 1
}

node_bin="$(resolve_node_bin || true)"
if [[ -z "$node_bin" ]]; then
	echo "no self-contained $node_arch node found; set APPLE_CUA_NODE to a standalone node binary (Homebrew's node links libnode.dylib and cannot be bundled), or run ./scripts/setup.sh, which downloads one" >&2
	exit 1
fi
if [[ "$(arch_of_node "$node_bin")" != "$node_arch" ]]; then
	echo "$node_bin is built for $(arch_of_node "$node_bin") and this Mac needs $node_arch; set APPLE_CUA_NODE to a $node_arch node from https://nodejs.org" >&2
	exit 1
fi
if [[ ! -f "$server" ]]; then
	echo "missing $server; run: pnpm --filter @apple-cua/mcp build" >&2
	exit 1
fi
if [[ ! -f "$launcher_source" ]]; then
	echo "missing $launcher_source" >&2
	exit 1
fi
if [[ ! -f "$icon_source" ]]; then
	echo "missing $icon_source" >&2
	exit 1
fi

version="$("$node_bin" -p 'require(process.argv[1]).version' "$repo/packages/mcp/package.json")"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

cp -c "$node_bin" "$app/Contents/Resources/node" 2>/dev/null || cp "$node_bin" "$app/Contents/Resources/node"
chmod 755 "$app/Contents/Resources/node"

cc "${launcher_flags[@]}" -o "$app/Contents/MacOS/$executable" "$launcher_source"

# The icon ships as a multi-resolution .icns so Finder, System Settings and the privacy panes
# render the helper as an app instead of a generic process.
iconset="$out_dir/appicon.iconset"
rm -rf "$iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
	sips -z "$size" "$size" "$icon_source" --out "$iconset/icon_${size}x${size}.png" >/dev/null
	sips -z "$((size * 2))" "$((size * 2))" "$icon_source" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/appicon.icns"
rm -rf "$iconset"

info_plist "$version" >"$app/Contents/Info.plist"
if ! plutil -lint "$app/Contents/Info.plist" >/dev/null; then
	echo "Info.plist failed plutil -lint" >&2
	exit 1
fi
inputs_digest >"$app/$stamp"

# The bundled Node carries the bundle's identifier and is signed before the bundle, so a grant
# recorded for the bundle id covers the process that asks and the bundle seal covers it (and the stamp).
codesign --force --sign "$sign_identity" --identifier "$bundle_id" "$app/Contents/Resources/node"
# Hardened runtime stays off: the executable is Node and needs its JIT pages.
codesign --force --sign "$sign_identity" "$app"
codesign --verify --deep --strict "$app"

echo "built $app ($bundle_id) with node $("$node_bin" --version) for $host_arch from $node_bin"
if [[ "$sign_identity" == "-" ]]; then
	echo "note: ad-hoc signed, so this build is a new code identity; macOS will ask for Screen Recording and Accessibility again (set APPLE_CUA_SIGN_IDENTITY for one stable identity across builds)"
fi
codesign -dv "$app" 2>&1 | sed -n '1,6p'
