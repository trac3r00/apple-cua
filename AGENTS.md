# macos-cua Agent Conventions

## TypeScript Standards
- Ultra-strict TypeScript with all strict flags enabled
- ESM modules with `.js` import suffixes under Node16 resolution
- Tabs for indentation (width 3 for display), line width 120 — enforced by Biome
- No `any`, `@ts-ignore`, `@ts-expect-error`, or non-essential type assertions
- Use `import type` for type-only imports

## Project Structure
- Monorepo with pnpm workspaces
- `packages/core`: Platform-abstracted computer-use interfaces
- `packages/cli`: Command-line interface
- `packages/mcp`: Model Context Protocol server
- `packages/pi-extension`: Pi coding agent extension
- `skills/`: Agent skill definitions

## Testing
- Vitest for all tests
- Test naming: `#given #when #then` pattern
- Coverage via v8 provider

## macOS Native APIs
- Screenshot: ScreenCaptureKit/IOSurface (preferred) or `screencapture` CLI fallback
- Input: koffi-bound CoreGraphics CGEvent (CGEventPost for global, CGEventPostToPid for per-PID); no CLI fallback
- Accessibility: `osascript` for UI queries when needed

## Platform Abstraction
- Abstract `ComputerInterface` with methods: screenshot, click, doubleClick, type, key, scroll, drag, getCursorPosition
- Implementations: `MacOSHostComputer` (native), `QemuComputer` (interface only), `CloudComputer` (interface only)
- All unimplemented platforms should have interface stubs with `throw new Error("Not implemented")`
