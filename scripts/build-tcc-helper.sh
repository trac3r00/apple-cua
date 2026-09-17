#!/usr/bin/env bash
# Builds the signed TCC helper app for the apple-cua MCP server.
#
# macOS attributes Screen Recording and Accessibility to the process that asks, and an
# identity-less process is attributed to whatever launched it. This bundle gives the server its
# own identity: a small launcher is the bundle's executable, and it spawns the bundled Node with
# responsibility disclaimed, so the server's asks name dev.applecua.mcp instead of the host.
#
# Note for rebuilds: with ad-hoc signing (the default) the code identity changes on every build,
# so macOS treats a rebuilt bundle as a new app and asks for Screen Recording and Accessibility
# again. Set APPLE_CUA_SIGN_IDENTITY to a stable certificate to keep one identity across builds.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="${1:-$repo/packages/mcp/dist}"
app="$out_dir/apple-cua-mcp.app"
bundle_id="dev.applecua.mcp"
executable="apple-cua-mcp"
server="$repo/packages/mcp/dist/server.js"
launcher_source="$repo/scripts/tcc-helper-launcher.c"
icon_source="$repo/packages/mcp/assets/appicon.png"
node_bin="${APPLE_CUA_NODE:-}"
sign_identity="${APPLE_CUA_SIGN_IDENTITY:--}"

# Only a self-contained Node can live inside the bundle: Homebrew's build links libnode.dylib and
# Cellar paths that do not exist there, so copying it produces a bundle whose launcher dies with
# "Library not loaded" at runtime. Prefer APPLE_CUA_NODE, then the first standalone node on PATH
# and in the usual local installs, and refuse loudly instead of shipping a broken bundle.
bundled_node_is_self_contained() {
	local dependencies
	dependencies="$(otool -L "$1" 2>/dev/null || true)"
	[[ -n "$dependencies" ]] || return 1
	! grep -Eq 'libnode|/opt/homebrew|/usr/local/(opt|Cellar)' <<<"$dependencies"
}

resolve_node_bin() {
	if [[ -n "$node_bin" ]]; then
		printf '%s\n' "$node_bin"
		return 0
	fi
	local candidate
	while IFS= read -r candidate; do
		[[ -n "$candidate" && -x "$candidate" ]] || continue
		if bundled_node_is_self_contained "$candidate"; then
			printf '%s\n' "$candidate"
			return 0
		fi
	done < <(which -a node 2>/dev/null || true; printf '%s\n' "$HOME/.local/bin/node" "/usr/local/bin/node")
	return 1
}

node_bin="$(resolve_node_bin || true)"
if [[ -z "$node_bin" ]]; then
	echo "no self-contained node found; set APPLE_CUA_NODE to a standalone node binary (Homebrew's node links libnode.dylib and cannot be bundled)" >&2
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

version="$(node -p "require('$repo/packages/mcp/package.json').version")"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

cp -c "$node_bin" "$app/Contents/Resources/node" 2>/dev/null || cp "$node_bin" "$app/Contents/Resources/node"
chmod 755 "$app/Contents/Resources/node"

cc -O2 -Wall -o "$app/Contents/MacOS/$executable" "$launcher_source"

# The icon ships as a multi-resolution .icns so Finder, System Settings and the privacy panes
# render dev.applecua.mcp as an app instead of a generic process.
iconset="$out_dir/appicon.iconset"
rm -rf "$iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
	sips -z "$size" "$size" "$icon_source" --out "$iconset/icon_${size}x${size}.png" >/dev/null
	sips -z "$((size * 2))" "$((size * 2))" "$icon_source" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/appicon.icns"
rm -rf "$iconset"

cat > "$app/Contents/Info.plist" <<PLIST
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
	<string>$version</string>
	<key>CFBundleVersion</key>
	<string>$version</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>NSAppleEventsUsageDescription</key>
	<string>apple-cua drives the apps and the iPhone Mirroring window you approve.</string>
</dict>
</plist>
PLIST

if ! plutil -lint "$app/Contents/Info.plist" >/dev/null; then
	echo "Info.plist failed plutil -lint" >&2
	exit 1
fi

# The bundled Node carries the bundle's identifier and is signed before the bundle, so a grant
# recorded for dev.applecua.mcp covers the process that asks and the bundle seal covers it.
codesign --force --sign "$sign_identity" --identifier "$bundle_id" "$app/Contents/Resources/node"
# Hardened runtime stays off: the executable is Node and needs its JIT pages.
codesign --force --sign "$sign_identity" "$app"
codesign --verify --deep --strict "$app"

echo "built $app with node $("$node_bin" --version) from $node_bin"
if [[ "$sign_identity" == "-" ]]; then
	echo "note: ad-hoc signed, so this build is a new code identity; macOS will ask for Screen Recording and Accessibility again (set APPLE_CUA_SIGN_IDENTITY for one stable identity across builds)"
fi
codesign -dv "$app" 2>&1 | sed -n '1,6p'
echo
echo "register it with:"
echo "  grok mcp add apple-cua -s user \\"
echo "    -e APPLE_CUA_ALLOWED_BUNDLE_IDS=com.apple.TextEdit -e APPLE_CUA_DELIVERY=background \\"
echo "    -- \"$app/Contents/MacOS/$executable\" \"$server\""
