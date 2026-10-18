import { readSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { connectionSchema, readConnection } from "./connection.js";
import { EXTENSION_ID, NATIVE_HOST_NAME, extensionIdSchema } from "./service.js";

export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;

const requestSchema = z.object({ method: z.literal("connection") }).strict();
type NativeHostOptions = {
	readonly stateDirectory?: string;
	readonly extensionId?: string;
};

export const nativeHostErrorSchema = z.object({
	error: z.string().max(32),
	message: z.string().max(120),
});

const responseSchema = z.union([connectionSchema, nativeHostErrorSchema]);
export type NativeHostResponse = z.infer<typeof responseSchema>;

function errorResponse(code: string, message: string): NativeHostResponse {
	return { error: code, message };
}

export function decodeNativeMessage(frame: Buffer): unknown {
	if (frame.length < 4) throw new Error("Native message header is incomplete.");
	const size = frame.readUInt32LE(0);
	if (size > MAX_NATIVE_MESSAGE_BYTES) throw new Error("Native message exceeds the size limit.");
	if (frame.length !== size + 4) throw new Error("Native message frame length is invalid.");
	return JSON.parse(frame.subarray(4).toString("utf8"));
}

export function encodeNativeMessage(response: NativeHostResponse): Buffer {
	const body = Buffer.from(JSON.stringify(response), "utf8");
	if (body.length > MAX_NATIVE_MESSAGE_BYTES) {
		throw new Error("Native message response exceeds the size limit.");
	}
	const frame = Buffer.allocUnsafe(body.length + 4);
	frame.writeUInt32LE(body.length, 0);
	body.copy(frame, 4);
	return frame;
}

export async function resolveNativeMessage(
	origin: string,
	frame: Buffer,
	options: NativeHostOptions = {},
): Promise<NativeHostResponse> {
	const extensionId = extensionIdSchema.parse(options.extensionId ?? EXTENSION_ID);
	const authorizedOrigin = `chrome-extension://${extensionId}/`;
	if (origin !== authorizedOrigin) {
		return errorResponse("unauthorized", "The native host origin is not authorized.");
	}
	let request: unknown;
	try {
		request = decodeNativeMessage(frame);
	} catch {
		return errorResponse("invalid_request", "The native host request is invalid.");
	}
	if (!requestSchema.safeParse(request).success) {
		return errorResponse("invalid_request", "The native host request is invalid.");
	}
	try {
		const connection =
			options.stateDirectory === undefined ? await readConnection() : await readConnection(options.stateDirectory);
		return responseSchema.parse(connection);
	} catch {
		return errorResponse("unavailable", "Browser connection metadata is unavailable.");
	}
}

function readExactly(size: number): Buffer {
	const buffer = Buffer.allocUnsafe(size);
	let offset = 0;
	while (offset < size) {
		const count = readSync(0, buffer, offset, size - offset, null);
		if (count === 0) throw new Error("Native messaging input ended early.");
		offset += count;
	}
	return buffer;
}

async function nativeHostMain(): Promise<void> {
	let response: NativeHostResponse;
	try {
		const header = readExactly(4);
		const size = header.readUInt32LE(0);
		if (size > MAX_NATIVE_MESSAGE_BYTES) {
			response = errorResponse("invalid_request", "The native host request is too large.");
		} else {
			const frame = Buffer.concat([header, readExactly(size)]);
			response = await resolveNativeMessage(process.argv[2] ?? "", frame, {
				extensionId: process.env["APPLE_CUA_BROWSER_EXTENSION_ID"] ?? EXTENSION_ID,
			});
		}
	} catch {
		response = errorResponse("invalid_request", "The native host request is invalid.");
	}
	process.stdout.write(encodeNativeMessage(response));
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void nativeHostMain().catch(() => {
		process.stderr.write(`${NATIVE_HOST_NAME}: unable to return connection metadata\n`);
		process.exitCode = 1;
	});
}
