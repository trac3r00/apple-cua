import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveStateDir } from "@apple-cua/core/stop";
import { z } from "zod";

export const connectionSchema = z.object({
	port: z.number().int().min(1).max(65535),
	token: z.string().regex(/^[0-9a-f]{64}$/i),
});

export type Connection = z.infer<typeof connectionSchema>;

const CONNECTION_FILE_NAME = "browser-connection.json";

export async function readConnection(stateDir: string = resolveStateDir()): Promise<Connection> {
	const raw = await readFile(join(stateDir, CONNECTION_FILE_NAME), "utf8");
	return connectionSchema.parse(JSON.parse(raw));
}

export async function writeConnection(connection: Connection, stateDir: string = resolveStateDir()): Promise<void> {
	const parsed = connectionSchema.parse(connection);
	await mkdir(stateDir, { recursive: true, mode: 0o700 });
	const path = join(stateDir, CONNECTION_FILE_NAME);
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
	await rename(temporary, path);
}

export async function connectionToken(stateDir: string = resolveStateDir()): Promise<string> {
	try {
		return (await readConnection(stateDir)).token;
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return randomBytes(32).toString("hex");
		}
		throw error;
	}
}
