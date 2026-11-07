export interface HistoryApp {
	readonly bundleIdentifier: string;
	readonly name: string;
	readonly processIdentifier: number;
}

export interface HistoryWindow {
	readonly windowID: number;
	readonly title: string;
	readonly url?: string;
}

export interface HistoryElement {
	readonly role: string;
	readonly title?: string;
	readonly description?: string;
	readonly value?: string;
}

export interface HistoryAx {
	readonly mode: "fullTree" | "diffFromPrevious";
	readonly text: string;
}

export type HistoryEventKind =
	| "session.started"
	| "window.changed"
	| "selection.changed"
	| "keyboard.text_input"
	| "keyboard.shortcut"
	| "mouse.click"
	| "mouse.drag";

interface HistoryEventBase {
	readonly id: number;
	readonly kind: HistoryEventKind;
	readonly timestamp: string;
}

export interface SessionStartedEvent extends HistoryEventBase {
	readonly kind: "session.started";
}

export interface WindowChangedEvent extends HistoryEventBase {
	readonly kind: "window.changed";
	readonly app: HistoryApp;
	readonly window: HistoryWindow;
	readonly ax?: HistoryAx;
}

export interface SelectionChangedEvent extends HistoryEventBase {
	readonly kind: "selection.changed";
	readonly app: HistoryApp;
	readonly window?: HistoryWindow;
	readonly selection: { readonly target: HistoryElement; readonly text?: string };
}

export interface KeyboardTextInputEvent extends HistoryEventBase {
	readonly kind: "keyboard.text_input";
	readonly app: HistoryApp;
	readonly window?: HistoryWindow;
	readonly keyboard: { readonly text: string; readonly target?: HistoryElement };
}

export interface KeyboardShortcutEvent extends HistoryEventBase {
	readonly kind: "keyboard.shortcut";
	readonly app: HistoryApp;
	readonly window?: HistoryWindow;
	readonly keyboard: { readonly keyEquivalent: string; readonly target?: HistoryElement };
}

export interface MouseClickEvent extends HistoryEventBase {
	readonly kind: "mouse.click";
	readonly app: HistoryApp;
	readonly window?: HistoryWindow;
	readonly mouse: { readonly button: string; readonly target?: HistoryElement };
	readonly ax?: HistoryAx;
}

export interface MouseDragEvent extends HistoryEventBase {
	readonly kind: "mouse.drag";
	readonly app: HistoryApp;
	readonly window?: HistoryWindow;
	readonly mouse: {
		readonly button: string;
		readonly clickCount?: number;
		readonly origin: { readonly app: HistoryApp; readonly window?: HistoryWindow; readonly element?: HistoryElement };
		readonly destination: {
			readonly app: HistoryApp;
			readonly window?: HistoryWindow;
			readonly element?: HistoryElement;
		};
	};
}

export type HistoryEvent =
	| SessionStartedEvent
	| WindowChangedEvent
	| SelectionChangedEvent
	| KeyboardTextInputEvent
	| KeyboardShortcutEvent
	| MouseClickEvent
	| MouseDragEvent;

export function encodeHistoryEvent(event: HistoryEvent): string {
	return JSON.stringify(event);
}
