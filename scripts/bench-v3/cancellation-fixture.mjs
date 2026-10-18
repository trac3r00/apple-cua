import { realpathSync } from "node:fs";

export function cancellationFixtureDirectory(directory) {
	return realpathSync(directory);
}
