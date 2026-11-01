#!/usr/bin/env bash
# Read-only dependency checks shared by direct setup and install.sh's setup path.
set -Eeuo pipefail

missing=0
if ! { command -v pkg-config >/dev/null 2>&1 && pkg-config --exists atspi-2; } &&
	! { command -v ldconfig >/dev/null 2>&1 && ldconfig -p 2>/dev/null | grep 'libatspi' >/dev/null; } &&
	! command -v at-spi-bus-launcher >/dev/null 2>&1 &&
	[[ ! -x /usr/libexec/at-spi-bus-launcher && ! -x /usr/lib/at-spi2-core/at-spi-bus-launcher ]]; then
	printf 'Missing AT-SPI runtime (at-spi2-core).\n'
	missing=1
fi
if ! command -v xdotool >/dev/null 2>&1 && ! command -v ydotool >/dev/null 2>&1; then
	printf 'Missing input tool: install xdotool (X11) or ydotool (Wayland).\n'
	missing=1
fi
if ! command -v grim >/dev/null 2>&1 && ! command -v scrot >/dev/null 2>&1 &&
	! command -v gnome-screenshot >/dev/null 2>&1 && ! command -v import >/dev/null 2>&1; then
	printf 'Missing screenshot tool: grim, scrot, gnome-screenshot or ImageMagick import.\n'
	missing=1
fi
if ((missing)); then
	printf '%s\n' \
		'apt (X11): sudo apt-get update && sudo apt-get install at-spi2-core libatspi2.0-0 xdotool gnome-screenshot' \
		'dnf (X11): sudo dnf install at-spi2-core xdotool gnome-screenshot' \
		'pacman (X11): sudo pacman -S at-spi2-core xdotool gnome-screenshot' \
		'apt (Wayland): sudo apt-get install at-spi2-core libatspi2.0-0 ydotool grim' \
		'dnf (Wayland): sudo dnf install at-spi2-core ydotool grim' \
		'pacman (Wayland): sudo pacman -S at-spi2-core ydotool grim' \
		'Run inside a desktop session with accessibility enabled; Wayland input needs a configured ydotool daemon.'
	exit 1
fi
printf 'Linux accessibility, input and screenshot dependencies found.\n'
