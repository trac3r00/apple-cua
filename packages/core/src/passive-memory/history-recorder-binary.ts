import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

const candidatePaths: readonly string[] = [
	join(moduleDirectory, "../../native/history-recorder"),
	join(moduleDirectory, "../../../native/history-recorder"),
	join(moduleDirectory, "../../../../native/history-recorder"),
];

export function resolveHistoryRecorderBinary(): string | undefined {
	return candidatePaths.find((path) => existsSync(path));
}
