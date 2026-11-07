import { describe, expect, it } from "bun:test";
import { manageWorkersSchema } from "./tool-schemas.js";

function assign(overrides: Record<string, string>) {
	return { op: "assign", assignments: [{ worker_id: "w1", task: "read", app: "Finder", ...overrides }] };
}

describe("#given manage_workers names #when validated #then they follow the cursor-owner rule", () => {
	it.each([
		["a worker id with a control character", { worker_id: "w\u0007" }],
		["a blank worker id", { worker_id: "   " }],
		["a worker id over 128 characters", { worker_id: "w".repeat(129) }],
		["an agent name with a control character", { agent_name: "Read\u0000er" }],
		["a parent agent name with a control character", { parent_agent_name: "Lead\u007f" }],
	])("rejects %s", (_label, overrides) => {
		expect(manageWorkersSchema.safeParse(assign(overrides)).success).toBe(false);
	});

	it("accepts names the cursor-owner rule accepts", () => {
		const parsed = manageWorkersSchema.safeParse(
			assign({ worker_id: "w".repeat(128), agent_name: " Reader ", parent_agent_name: "OmO" }),
		);
		expect(parsed.success).toBe(true);
		expect(parsed.data?.assignments?.[0]?.agent_name).toBe("Reader");
	});
});
