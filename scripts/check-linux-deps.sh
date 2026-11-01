#!/usr/bin/env bash
# Read-only dependency checks shared by direct setup and install.sh's setup path.
# Probes exactly what the Linux backend uses: Python GI for AT-SPI and GdkPixbuf, grim or the
# desktop portal on Wayland, ImageMagick `import` on X11. Physical input is opt-in, so its tool
# is reported as optional rather than failing the installation.
set -Eeuo pipefail

missing=0
if ! python3 -c "import gi; gi.require_version('Atspi', '2.0'); gi.require_version('GdkPixbuf', '2.0'); from gi.repository import Atspi, GdkPixbuf" >/dev/null 2>&1; then
	printf 'Missing Python GI with the AT-SPI and GdkPixbuf typelibs.\n'
	missing=1
fi
if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
	command -v grim >/dev/null 2>&1 ||
		printf 'Optional: grim is not installed; captures fall back to the xdg-desktop-portal screenshot.\n'
	command -v ydotool >/dev/null 2>&1 ||
		printf 'Optional: ydotool (and its daemon) is needed only for opt-in physical input on Wayland.\n'
else
	if ! command -v import >/dev/null 2>&1; then
		printf 'Missing ImageMagick import, which X11 window capture uses.\n'
		missing=1
	fi
	command -v xdotool >/dev/null 2>&1 ||
		printf 'Optional: xdotool is needed only for opt-in physical input on X11.\n'
fi
if ((missing)); then
	printf '%s\n' \
		'apt: sudo apt-get update && sudo apt-get install at-spi2-core python3-gi gir1.2-atspi-2.0 gir1.2-gdkpixbuf-2.0 imagemagick' \
		'dnf: sudo dnf install at-spi2-core python3-gobject gdk-pixbuf2 ImageMagick' \
		'pacman: sudo pacman -S at-spi2-core python-gobject gdk-pixbuf2 imagemagick' \
		'Wayland: install grim instead of imagemagick; physical input additionally needs ydotool and its daemon.' \
		'X11: physical input additionally needs xdotool.' \
		'Run inside a desktop session with accessibility enabled.'
	exit 1
fi
printf 'Linux accessibility and screenshot dependencies found.\n'
