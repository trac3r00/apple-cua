import { AsyncLocalStorage } from "node:async_hooks";

export interface CursorOwner {
	readonly agentName: string;
	readonly sessionId: string;
	readonly parentAgentName?: string;
}

interface CursorContext {
	readonly identity: string;
	readonly owner?: CursorOwner;
}

const cursorIdentity = new AsyncLocalStorage<CursorContext>();

export function withCursorIdentity<T>(identity: string, callback: () => T, owner?: CursorOwner): T {
	if (owner === undefined) return cursorIdentity.run({ identity }, callback);
	for (const name of [owner.agentName, owner.sessionId, owner.parentAgentName]) {
		if (
			name !== undefined &&
			(name.trim().length === 0 ||
				name.length > 128 ||
				Array.from(name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
		) {
			throw new TypeError("Cursor owner names and session IDs must be nonempty and contain no control characters.");
		}
	}
	const snapshot: CursorOwner = Object.freeze({
		agentName: owner.agentName.trim(),
		sessionId: owner.sessionId.trim(),
		...(owner.parentAgentName === undefined ? {} : { parentAgentName: owner.parentAgentName.trim() }),
	});
	return cursorIdentity.run({ identity, owner: snapshot }, callback);
}

export function currentCursorIdentity(): string | undefined {
	return cursorIdentity.getStore()?.identity;
}

export function currentCursorOwner(): CursorOwner | undefined {
	return cursorIdentity.getStore()?.owner;
}
