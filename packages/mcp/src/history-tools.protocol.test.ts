import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type HistorySkillDetection, type HistorySkillDraft, detectHistorySkillCandidates } from "@opencua/core";
import { z } from "zod/v4";
import {
	type HistoryObservationSettings,
	type HistoryStatus,
	type HistoryToolSource,
	registerHistoryTools,
} from "./history-tools.js";

const DEFAULTS: HistoryObservationSettings = {
	defaultApplicationBehavior: "observe",
	defaultURLBehavior: "observe",
	observePrivateBrowsing: false,
	rules: [],
};

class FakeHistory implements HistoryToolSource {
	state: HistoryStatus["state"] = "running";
	settings: HistoryObservationSettings = DEFAULTS;

	status(): HistoryStatus {
		return {
			state: this.state,
			eventStreamRootPath: "/root",
			summariesPath: "/summaries",
			retentionHours: 6,
			currentSegmentId: "2026-10-29T04-00-00Z",
		};
	}

	getSettings(): HistoryObservationSettings {
		return this.settings;
	}

	updateSettings(settings: HistoryObservationSettings): HistoryObservationSettings {
		this.settings = settings;
		return this.settings;
	}

	pause(): void {
		this.state = "paused";
	}

	resume(): void {
		this.state = "running";
	}

	saved: HistorySkillDraft[] = [];

	async suggestSkills(options: { readonly limit: number }): Promise<HistorySkillDetection> {
		const step = (app: string, title: string) => ({
			kind: "window.changed",
			timestamp: "2026-11-01T10:00:00Z",
			app: { name: app },
			window: { title },
		});
		const flow = [step("Safari", "Invoice"), step("Notes", "Ledger"), step("Mail", "Draft")];
		return detectHistorySkillCandidates([{ id: "2026-11-01T10-00-00Z", events: [...flow, ...flow] }], options);
	}

	async saveSkill(draft: HistorySkillDraft): Promise<string> {
		this.saved.push(draft);
		return `/skills/${draft.name}/SKILL.md`;
	}
}

async function connect(source: HistoryToolSource): Promise<Client> {
	const server = new McpServer({ name: "test", version: "0.0.0" });
	registerHistoryTools(server, source);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test-client", version: "0.0.0" });
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return client;
}

function payload(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
	const content = z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).parse(result.content);
	const text = content.find((item) => item.type === "text")?.text ?? "{}";
	return z.record(z.string(), z.unknown()).parse(JSON.parse(text));
}

describe("#given cua-history tools #when status is called #then it returns state and paths", () => {
	it("reports the state, segment root, and summaries path", async () => {
		const client = await connect(new FakeHistory());
		const result = payload(await client.callTool({ name: "cua_history_status", arguments: {} }));
		expect(result).toMatchObject({ state: "running", eventStreamRootPath: "/root", retentionHours: 6 });
	});
});

describe("#given a running recorder #when pause then resume are called #then the state flips and back", () => {
	it("pauses and resumes", async () => {
		const client = await connect(new FakeHistory());
		expect(payload(await client.callTool({ name: "cua_history_pause", arguments: {} }))["state"]).toBe("paused");
		expect(payload(await client.callTool({ name: "cua_history_resume", arguments: {} }))["state"]).toBe("running");
	});
});

describe("#given new settings #when update_settings is called #then the whole document is replaced", () => {
	it("replaces settings and reads them back", async () => {
		const fake = new FakeHistory();
		const client = await connect(fake);
		const next: HistoryObservationSettings = {
			defaultApplicationBehavior: "do_not_observe",
			defaultURLBehavior: "observe",
			observePrivateBrowsing: false,
			rules: [{ scope: "app", bundleID: "com.apple.Terminal", behavior: "observe" }],
		};

		await client.callTool({ name: "cua_history_update_settings", arguments: next });
		const read = payload(await client.callTool({ name: "cua_history_get_settings", arguments: {} }));
		expect(read).toMatchObject({ defaultApplicationBehavior: "do_not_observe" });
		expect(fake.settings.rules).toHaveLength(1);
	});

	it("rejects an invalid rule scope", async () => {
		const client = await connect(new FakeHistory());
		const result = await client.callTool({
			name: "cua_history_update_settings",
			arguments: {
				defaultApplicationBehavior: "observe",
				defaultURLBehavior: "observe",
				observePrivateBrowsing: false,
				rules: [{ scope: "folder", bundleID: "x", behavior: "observe" }],
			},
		});
		expect(result.isError).toBe(true);
	});
});

describe("#given repeated recorded workflows #when suggest_skills is called #then candidates come back inline", () => {
	it("returns a numbered candidate with readable steps and next-step guidance", async () => {
		const client = await connect(new FakeHistory());
		const result = payload(await client.callTool({ name: "cua_history_suggest_skills", arguments: { limit: 3 } }));
		expect(result["candidates"]).toEqual([
			expect.objectContaining({
				number: 1,
				occurrences: 2,
				apps: ["Mail", "Notes", "Safari"],
				steps: ["switch to Safari (invoice)", "switch to Notes (ledger)", "switch to Mail (draft)"],
			}),
		]);
		expect(String(result["next"])).toContain("cua_history_save_skill");
	});
});

describe("#given a description a small model wrote earlier #when suggest_skills is called #then the candidate carries it", () => {
	it("returns the model's name, title and summary next to the raw steps", async () => {
		const fake = new FakeHistory();
		const id = (await fake.suggestSkills({ limit: 1 })).candidates[0]?.id ?? "";
		const description = {
			name: "invoice-to-ledger",
			title: "Move an invoice into the ledger",
			summary: "Opens the invoice, the ledger and a mail draft in turn.",
			whenToUse: "When an invoice arrives.",
		};
		const described = Object.assign(fake, { skillDescriptions: async () => ({ [id]: description }) });
		const client = await connect(described);
		const result = payload(await client.callTool({ name: "cua_history_suggest_skills", arguments: { limit: 1 } }));
		expect(result["candidates"]).toEqual([
			expect.objectContaining({ proposedName: "invoice-to-ledger", description, steps: expect.any(Array) }),
		]);
	});
});

describe("#given an approved draft #when save_skill is called #then the source saves it and returns the path", () => {
	it("saves valid drafts and rejects an invalid name", async () => {
		const fake = new FakeHistory();
		const client = await connect(fake);
		const draft = { name: "invoice-ledger", description: "Copy invoice totals into the ledger", body: "# Steps" };
		expect(payload(await client.callTool({ name: "cua_history_save_skill", arguments: draft }))["path"]).toBe(
			"/skills/invoice-ledger/SKILL.md",
		);
		const bad = await client.callTool({ name: "cua_history_save_skill", arguments: { ...draft, name: "Bad Name" } });
		expect(bad.isError).toBe(true);
		expect(fake.saved).toEqual([draft]);
	});
});
