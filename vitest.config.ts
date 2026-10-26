import { defineConfig } from "vitest/config";

const runningUnderBun = "bun" in process.versions;

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["packages/**/*.test.ts"],
		// Bun's Vitest loader mis-resolves zod's named `z` export; inlining only for
		// Bun keeps Node runs on the previous externalized path.
		...(runningUnderBun ? { server: { deps: { inline: ["zod"] } } } : {}),
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
		},
	},
});
