#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ "$(uname -s)" != "Darwin" ]]; then echo "cua-helper is macOS-only, skipping"; exit 0; fi
if ! command -v swift >/dev/null 2>&1; then echo "Swift toolchain not found — install Xcode CLT for cua-helper. mouse will fall back to global path."; exit 0; fi
if ! swift build -c release; then echo "warning: cua-helper build failed — install Xcode CLT or run swift build manually. per-PID mouse will be unavailable." >&2; exit 0; fi
mkdir -p ../core/dist/bin
cp .build/release/cua-helper ../core/dist/bin/cua-helper
echo "✓ cua-helper built → packages/core/dist/bin/cua-helper ($(stat -f%z .build/release/cua-helper) bytes)"
