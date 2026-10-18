# Browser connection panel

## Purpose

Preserve the existing native-looking settings panel. This is a local connection
utility, not a marketing page or a browser dashboard. No external fonts, images,
animations, libraries, or page startup windows.

## Reference

The existing options captures under `.omo/evidence/apple-cua-browser` are the
visual baseline. Retain system fonts, system light/dark colors, one centered
column, visible labels, masked local keys and in-place status feedback.

## Tokens

- Measure: 32 rem maximum; horizontal inset: 1 rem; top/bottom margin: 2 rem.
- Font: system-ui, sans-serif; body: 16 px / 1.5; compact-width body: 17 px.
- Heading: 1.5 rem, bold. Spacing: .5 rem, 1 rem, 2 rem.
- Colors: native Canvas, CanvasText and browser-native form control colors.
- Enabled local connect action: system Highlight / HighlightText; native disabled state when already connected.
- Interactive controls: at least 44 px tall; native visible keyboard focus.

## Layout

Brand title, short background-mode explanation, local connection action and
stop action, optional manual settings disclosure, then live connection status.
Manual fields are secondary, not a prerequisite for automatic onboarding.

## Primitives and states

Native buttons, labeled inputs, details/summary and aria-live status. Keyboard
order follows reading order. States: connected, disconnected with remedy,
connecting, local-host error, paused with explicit human resume.

## Accessibility and performance

Keep the stop control always visible. No color-only states, no hidden labels,
no password display, no motion or loading animation. Native controls retain
focus, hover and pressed states. The only JavaScript manages connection state.

## Verification

Capture collapsed and expanded manual settings at 390, 1440 and 1920 pixels in
light/dark. Check long error wrapping, keyboard navigation, 44 px targets and
no horizontal overflow. Chrome-extension SEO/public-site Lighthouse metrics
are not acceptance criteria for this private local utility.
