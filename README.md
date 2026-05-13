# macos-cua

Native macOS computer-use control with cua-style platform abstractions.

## Architecture

- `packages/core` - Platform-abstracted computer-use interfaces
- `packages/cli` - Command-line interface
- `packages/mcp` - Model Context Protocol server
- `packages/pi-extension` - Pi coding agent extension
- `skills/` - Agent skill definitions

## Development

```bash
# Install dependencies
pnpm install

# Type check
pnpm typecheck

# Lint
pnpm lint

# Test
pnpm test

# Build
pnpm build
```

## Usage

### CLI

```bash
# Screenshot
pnpm macos-cua screenshot -o screenshot.png

# Click
pnpm macos-cua click -x 100 -y 200

# Type text
pnpm macos-cua type "Hello World"

# Press key
pnpm macos-cua key cmd --modifiers cmd

# Get cursor position
pnpm macos-cua cursor

# Get screen size
pnpm macos-cua screen
```

### MCP Server

```bash
pnpm macos-cua-mcp
```

## Platform Abstraction

The project abstracts computer control across platforms:

- `HostComputer` - Native host OS control (implemented: macOS)
- `VMComputer` - Virtual machine control (interface only)
- `CloudComputer` - Cloud instance control (interface only)

## macOS Implementation

Uses native macOS tools:
- `screencapture` for screenshots
- `cliclick` for mouse/keyboard input
- `osascript` for screen size queries

Future improvements:
- ScreenCaptureKit/IOSurface for screenshots
- CoreGraphics CGEvent for input
- Accessibility APIs for UI queries
