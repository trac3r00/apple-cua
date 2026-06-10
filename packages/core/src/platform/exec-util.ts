export function execFileStdout(result: { readonly stdout: string | Buffer } | string | Buffer): string {
	if (typeof result === "string") {
		return result;
	}
	if (Buffer.isBuffer(result)) {
		return result.toString("utf8");
	}
	return Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : result.stdout;
}

export function execFileStdoutBuffer(result: { readonly stdout: string | Buffer } | string | Buffer): Buffer {
	if (Buffer.isBuffer(result)) {
		return result;
	}
	if (typeof result === "string") {
		return Buffer.from(result, "binary");
	}
	return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout, "binary");
}
