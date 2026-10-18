import { AsyncLocalStorage } from "node:async_hooks";

const cursorIdentity = new AsyncLocalStorage<string>();

export function withCursorIdentity<T>(identity: string, callback: () => T): T {
	return cursorIdentity.run(identity, callback);
}

export function currentCursorIdentity(): string | undefined {
	return cursorIdentity.getStore();
}
