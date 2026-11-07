/** Preserve legacy configuration without overriding an explicitly configured OpenCUA value. */
export function applyLegacyEnv(env: NodeJS.ProcessEnv): void {
	for (const [key, value] of Object.entries(env)) {
		if (key.startsWith("APPLE_CUA_") && value !== undefined) {
			const renamed = `OPENCUA_${key.slice("APPLE_CUA_".length)}`;
			if (env[renamed] === undefined) {
				env[renamed] = value;
			}
		}
	}
}

applyLegacyEnv(process.env);
