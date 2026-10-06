import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["packages/**/*.test.ts", "scripts/*.test.mjs"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
		},
	},
});
