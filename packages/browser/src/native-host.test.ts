import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConnection } from "./connection.js";
import {
	MAX_NATIVE_MESSAGE_BYTES,
	decodeNativeMessage,
	encodeNativeMessage,
	resolveNativeMessage,
} from "./native-host.js";
import { EXTENSION_ID } from "./service.js";

const extensionOrigin = `chrome-extension://${EXTENSION_ID}/`;
const requestFrame = (() => {
	const request = Buffer.from(JSON.stringify({ method: "connection" }));
	const frame = Buffer.alloc(request.length + 4);
	frame.writeUInt32LE(request.length, 0);
	request.copy(frame, 4);
	return frame;
})();

describe("browser native messaging host", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	});

	it("#given the authorized extension and stored metadata #when requesting connection #then returns only port and token", async () => {
		const stateDirectory = await mkdtemp(join(tmpdir(), "browser-native-host-"));
		directories.push(stateDirectory);
		const expected = { port: 47953, token: "a".repeat(64) };
		await writeConnection(expected, stateDirectory);

		const reply = await resolveNativeMessage(extensionOrigin, requestFrame, { stateDirectory });
		const decoded = decodeNativeMessage(encodeNativeMessage(reply));

		expect(decoded).toEqual(expected);
	});

	it("#given another extension origin #when requesting connection #then denies access", async () => {
		const reply = await resolveNativeMessage("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/", requestFrame);

		expect(reply).toMatchObject({ error: "unauthorized" });
	});

	it("#given a configured unpacked extension #when requesting metadata #then authorizes only that exact origin", async () => {
		const stateDirectory = await mkdtemp(join(tmpdir(), "browser-native-configured-"));
		directories.push(stateDirectory);
		const extensionId = "p".repeat(32);
		const expected = { port: 48999, token: "b".repeat(64) };
		await writeConnection(expected, stateDirectory);

		const accepted = await resolveNativeMessage(`chrome-extension://${extensionId}/`, requestFrame, {
			stateDirectory,
			extensionId,
		});
		const refused = await resolveNativeMessage(extensionOrigin, requestFrame, { stateDirectory, extensionId });

		expect(accepted).toEqual(expected);
		expect(refused).toMatchObject({ error: "unauthorized" });
	});

	it("#given missing metadata #when the authorized extension requests connection #then returns a bounded error", async () => {
		const stateDirectory = await mkdtemp(join(tmpdir(), "browser-native-host-"));
		directories.push(stateDirectory);

		const reply = await resolveNativeMessage(extensionOrigin, requestFrame, { stateDirectory });

		expect(reply).toMatchObject({ error: "unavailable" });
	});

	it("#given an oversized native message header #when decoding a frame #then rejects before parsing the payload", () => {
		const header = Buffer.alloc(4);
		header.writeUInt32LE(MAX_NATIVE_MESSAGE_BYTES + 1, 0);

		expect(() => decodeNativeMessage(header)).toThrow();
	});

	it("#given malformed native JSON #when requesting connection #then returns a bounded protocol error", async () => {
		const malformed = Buffer.from([1, 0, 0, 0, 0x7b]);

		const reply = await resolveNativeMessage(extensionOrigin, malformed);

		expect(reply).toMatchObject({ error: "invalid_request" });
	});
});
