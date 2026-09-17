/**
 * Value of an environment variable that was renamed with the project, still honouring the name it
 * shipped under before the rename.
 *
 * The current name wins. The legacy name keeps an existing harness configuration working — an
 * OpenClaw/Hermes MCP block or a shell profile written before the rename keeps selecting the same
 * allowlist and delivery mode instead of silently falling back to deny-by-default. An empty value
 * counts as unset, so a stale empty entry cannot shadow the legacy name.
 */
export function renamedEnvironmentVariable(
	primary: string,
	legacy: string,
	environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const value = environment[primary];
	if (value !== undefined && value !== "") {
		return value;
	}
	return environment[legacy];
}
