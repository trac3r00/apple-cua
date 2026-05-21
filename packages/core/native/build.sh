#!/usr/bin/env bash
# Build the libsckit.dylib helper for @macos-cua/core.
#
# Requires:
#   - clang (Xcode Command Line Tools)
#   - macOS 14.0+ SDK (for ScreenCaptureKit)
#
# Output:
#   packages/core/native/libsckit.dylib

set -eu

native_dir="$(cd "$(dirname "$0")" && pwd)"
source_path="${native_dir}/sckit.m"
output_path="${native_dir}/libsckit.dylib"

if [ ! -f "${source_path}" ]; then
	echo "error: missing ${source_path}" >&2
	exit 1
fi

clang \
	-arch arm64 \
	-dynamiclib \
	-O2 \
	-fobjc-arc \
	-mmacosx-version-min=14.0 \
	-framework ScreenCaptureKit \
	-framework CoreGraphics \
	-framework CoreMedia \
	-framework CoreVideo \
	-framework Foundation \
	-framework ImageIO \
	-framework CoreServices \
	"${source_path}" \
	-o "${output_path}"

echo "built ${output_path}"
