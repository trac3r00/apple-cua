#!/usr/bin/env bash
# Builds the signed TCC helper app for the apple-cua MCP server.
#
# macOS attributes Screen Recording and Accessibility to the process that asks, and an
# identity-less process is attributed to whatever launched it. This bundle gives the server its
# own identity: a small launcher is the bundle's executable, and it spawns the bundled Node with
# responsibility disclaimed, so the server's asks name dev.applecua.mcp instead of the host.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="${1:-$repo/packages/mcp/dist}"
app="$out_dir/apple-cua-mcp.app"
bundle_id="dev.applecua.mcp"
executable="apple-cua-mcp"
server="$repo/packages/mcp/dist/server.js"
launcher_source="$repo/scripts/tcc-helper-launcher.c"
node_bin="${APPLE_CUA_NODE:-$(command -v node || true)}"
sign_identity="${APPLE_CUA_SIGN_IDENTITY:--}"

if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
	echo "node not found; set APPLE_CUA_NODE to the Node binary to bundle" >&2
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

version="$(node -p "require('$repo/packages/mcp/package.json').version")"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

cp -c "$node_bin" "$app/Contents/Resources/node" 2>/dev/null || cp "$node_bin" "$app/Contents/Resources/node"
chmod 755 "$app/Contents/Resources/node"

cc -O2 -Wall -o "$app/Contents/MacOS/$executable" "$launcher_source"

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

echo "built $app"
codesign -dv "$app" 2>&1 | sed -n '1,6p'
echo
echo "register it with:"
echo "  grok mcp add apple-cua -s user \\"
echo "    -e APPLE_CUA_ALLOWED_BUNDLE_IDS=com.apple.TextEdit -e APPLE_CUA_DELIVERY=background \\"
echo "    -- \"$app/Contents/MacOS/$executable\" \"$server\""
