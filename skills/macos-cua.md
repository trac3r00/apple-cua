# macos-cua Skill

## Purpose
Provide native macOS computer-use control capabilities to the agent through platform-abstracted interfaces.

## Capabilities
- Screenshot capture (full screen or region)
- Mouse input (click, double-click, drag, scroll)
- Keyboard input (type text, press keys with modifiers)
- Cursor position queries
- Screen size queries

## Usage
The agent can use the following tools when this skill is active:

- `screenshot` - Capture a screenshot of the macOS screen
- `click` - Click at a specific position
- `double_click` - Double-click at a specific position
- `type` - Type text at the current cursor position
- `key` - Press a key with optional modifiers (cmd, alt, ctrl, shift)
- `scroll` - Scroll in a direction (up, down, left, right)
- `drag` - Drag from one point to another
- `cursor_position` - Get the current cursor position
- `screen_size` - Get the screen size

## Architecture
- `packages/core` - Platform-abstracted computer-use interfaces
- `packages/cli` - Command-line interface
- `packages/mcp` - Model Context Protocol server
- `packages/pi-extension` - Pi coding agent extension

## Implementation Notes
- Uses `screencapture` CLI for screenshots (ScreenCaptureKit/IOSurface preferred in future)
- Uses `cliclick` CLI for input (CoreGraphics CGEvent preferred in future)
- Uses `osascript` for screen size queries
- All platforms (QEMU, VirtualBox, VMware, Cloud) have interface stubs
