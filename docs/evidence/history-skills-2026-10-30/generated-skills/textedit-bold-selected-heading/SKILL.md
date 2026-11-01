---
name: "textedit-bold-selected-heading"
description: "Use when asked to apply bold formatting to one user-specified heading in a disposable TextEdit rich-text document on macOS. The skill requires fresh observation of the target app, window, document type and selection before acting, and requires fresh observation confirming the final formatting before reporting success. Do not use it for documents the user has not confirmed are disposable, for plain-text documents that would need conversion, or when the heading cannot be identified unambiguously."
---

# Bold a selected heading in a disposable TextEdit rich-text document

## What the recorded evidence shows and does not show

The source recording contains only four events in TextEdit (bundle `com.apple.TextEdit`):

1. A window change to a document window (title recorded as a test document).
2. A selection change whose target was the document text area (`AXTextArea`, description "Document text"). The recording does not include the selected range, the selected text, or whether it was a heading.
3. A keyboard shortcut `Command+B` sent to that text area.
4. A second window change to the same window.

The recording does NOT establish:

- which text was selected, or that it was a heading;
- that the document was in rich-text mode;
- the formatting state before or after `Command+B`;
- that bold was actually applied. `Command+B` toggles bold in TextEdit rich text, so the same shortcut can also remove bold, and it does nothing to font weight in a plain-text document.

Treat the recorded shortcut as a candidate action only. Success must be established by fresh observation after the action, never by the fact that the shortcut was sent.

## Inputs

- `app`: target application. Default `TextEdit` / `com.apple.TextEdit`; name it explicitly, never assume the frontmost app.
- `document`: the window title or window ID of the target document, as observed in the current session.
- `heading_text`: the exact text of the heading to bold, supplied by the user.
- `disposable_confirmed`: the user's explicit confirmation in the current session that the document is disposable and may be modified.

If any input is missing or ambiguous, ask the user (through `ask_user` or the host's question tool) before acting. Do not reuse window IDs, process IDs, or titles from the recording; they are historical values.

## Steps

1. **Confirm scope.** Verify `disposable_confirmed` is present for this session. If not, ask and stop until answered.
2. **Observe fresh state.** Call `get_app_state` for `app` and identify the window matching `document`. Record its current window ID and the returned observation token. If no matching window exists, report that and stop; do not open, create, or switch documents unless the user asked for that.
3. **Check document mode.** From the observed state (menu items, toolbar, or format bar), determine whether the document is rich text. If the observation shows it is plain text, or the mode cannot be determined, stop and report; do not convert the document without explicit user instruction.
4. **Locate the heading.** In the observed text area content, find `heading_text`. If it is absent, or appears more than once and the user has not said which occurrence, stop and ask.
5. **Check current formatting.** Determine from observation whether the heading is already bold (for example, the Bold state in the Format > Font menu or format bar while the heading is selected, or a clear visual reading of the screenshot). If it is already fully bold, report that and do not send `Command+B`, because the shortcut would toggle bold off. If the state cannot be determined, say so and ask before proceeding.
6. **Select exactly the heading.** Select the heading text using observed element IDs and text positions. Use screenshot coordinates only when the mapping between screenshot and target is clear. Then re-observe and confirm the selection covers exactly `heading_text` and nothing else. If the selection cannot be confirmed, stop.
7. **Apply bold.** With a fresh observation token, send `Command+B` to the observed text area (or choose the observed Bold menu item, if present in the current observation). Batch the selection and action into `run_steps` with an `expect`/verify block where available.
8. **Verify with fresh observation.** Observe again (or use `verify_state`) and confirm:
   - the heading text is now bold (via the Bold menu/format bar state with the heading selected, or a clear screenshot comparison);
   - surrounding text formatting is unchanged;
   - the heading text content is unchanged.
   If verification fails or is inconclusive, report the observed state honestly. Do not retry blindly; re-observe and diagnose first.

## Reporting

Report success only when step 8 produced direct evidence of bold formatting on the heading. Include what was observed (window, heading text, how bold state was confirmed). If any step stopped early, state which step, what was observed, and what input or decision is needed from the user.

## Do not

- Claim success because `Command+B` was sent.
- Invent element IDs, coordinates, menu items, or window titles not present in the current observation.
- Save, close, rename, or delete the document unless the user explicitly asked.
- Act on a document the user has not confirmed is disposable.
