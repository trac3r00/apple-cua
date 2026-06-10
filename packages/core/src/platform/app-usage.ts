export interface AppUsage {
	lastUsedDate?: string;
	useCount?: number;
}

const ATTRIBUTES_PER_APP = 2;

export function parseAppUsageBlocks(output: string, paths: readonly string[]): Map<string, AppUsage> {
	const usage = new Map<string, AppUsage>(paths.map((path) => [path, {}]));
	const lines = output.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length !== paths.length * ATTRIBUTES_PER_APP) {
		return usage;
	}
	paths.forEach((path, index) => {
		const lastUsed = attributeValue(lines[index * ATTRIBUTES_PER_APP]);
		const count = attributeValue(lines[index * ATTRIBUTES_PER_APP + 1]);
		const parsed: AppUsage = {};
		if (lastUsed !== undefined) {
			parsed.lastUsedDate = lastUsed;
		}
		const useCount = count === undefined ? Number.NaN : Number(count);
		if (Number.isInteger(useCount)) {
			parsed.useCount = useCount;
		}
		usage.set(path, parsed);
	});
	return usage;
}

function attributeValue(line: string | undefined): string | undefined {
	if (line === undefined) {
		return undefined;
	}
	const separatorIndex = line.indexOf("=");
	if (separatorIndex < 0) {
		return undefined;
	}
	const value = line.slice(separatorIndex + 1).trim();
	return value === "(null)" || value.length === 0 ? undefined : value;
}
