#!/usr/bin/env bash
# Builds the native helpers of @apple-cua/core as universal binaries (arm64 + x86_64), so one checkout
# runs on Apple Silicon and Intel Macs alike:
#
#   libsckit.dylib   ScreenCaptureKit capture shim. Deployment target 12.3, ScreenCaptureKit's own floor.
#                    The screenshot APIs it calls arrived in macOS 14.0 and sit behind @available, so on an
#                    older system the library still loads, answers "unavailable", and screenshot.ts takes its
#                    CoreGraphics or screencapture fallback.
#   cursor-overlay   the agent cursor overlay. Deployment target 11.0.
#
# Calling an API newer than a deployment target without an @available check is a build error, which keeps
# those targets true. The script ends by recording the hashes of its inputs in build-inputs.sha256;
# scripts/setup.sh compares them to tell whether the committed binaries still match their sources.
#
# Requires the Xcode Command Line Tools (clang, lipo) with a macOS SDK that ships ScreenCaptureKit.

set -euo pipefail

native_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
architectures=(-arch arm64 -arch x86_64)
availability_errors=(-Werror=unguarded-availability -Werror=unguarded-availability-new)

for source in sckit.m cursor-overlay.m; do
	if [[ ! -f "${native_dir}/${source}" ]]; then
		echo "error: missing ${native_dir}/${source}" >&2
		exit 1
	fi
done

clang \
	"${architectures[@]}" \
	-dynamiclib \
	-install_name @rpath/libsckit.dylib \
	-O2 \
	-fobjc-arc \
	-mmacosx-version-min=12.3 \
	"${availability_errors[@]}" \
	-framework ScreenCaptureKit \
	-framework CoreGraphics \
	-framework CoreMedia \
	-framework CoreVideo \
	-framework Foundation \
	-framework ImageIO \
	-framework CoreServices \
	"${native_dir}/sckit.m" \
	-o "${native_dir}/libsckit.dylib"
echo "built ${native_dir}/libsckit.dylib ($(lipo -archs "${native_dir}/libsckit.dylib"))"

clang \
	"${architectures[@]}" \
	-O2 \
	-fobjc-arc \
	-mmacosx-version-min=11.0 \
	"${availability_errors[@]}" \
	-framework Cocoa \
	-framework Foundation \
	"${native_dir}/cursor-overlay.m" \
	-o "${native_dir}/cursor-overlay"
echo "built ${native_dir}/cursor-overlay ($(lipo -archs "${native_dir}/cursor-overlay"))"

(cd "${native_dir}" && shasum -a 256 build.sh sckit.m cursor-overlay.m >build-inputs.sha256)
echo "recorded input hashes in ${native_dir}/build-inputs.sha256"
