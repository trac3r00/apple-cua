import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import { startHistoryUi } from "./history-ui.js";

const resources: { directory: string; close: () => Promise<void> }[] = [];
const id = "2026-10-30T10-00-00Z";
const draft = {
	name: "format-report",
	description: "Format a report heading",
	body: "# Format report\n\nVerify the title.",
};

async function fixture(
	generate: (prompt: string) => Promise<string> = async () => JSON.stringify(draft),
	now: () => number = Date.now,
) {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "apple-cua-history-ui-")));
	const segment = join(directory, "cua-history", "segments", id);
	await mkdir(segment, { recursive: true });
	await writeFile(
		join(segment, "metadata.json"),
		JSON.stringify({
			id,
			startedAt: "2026-10-30T10:00:00Z",
			endedAt: "2026-10-30T10:10:00Z",
			eventCount: 1,
			suppressedEventCount: 0,
		}),
	);
	await writeFile(
		join(segment, "events.jsonl"),
		`${JSON.stringify({
			kind: "window.changed",
			timestamp: "2026-10-30T10:01:00Z",
			app: { name: "Word", bundleIdentifier: "com.microsoft.Word", processIdentifier: 123 },
			window: { windowID: 1, title: "Synthetic report" },
		})}\n`,
	);
	const ui = await startHistoryUi({
		stateDirectory: directory,
		skillsDirectory: join(directory, "skills"),
		generate,
		now,
	});
	resources.push({ directory, close: ui.close });
	return {
		directory,
		url: ui.url,
		post: (action: string, body: unknown, origin?: string) =>
			fetch(`${ui.url}api/${action}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...(origin === undefined ? {} : { Origin: origin }) },
				body: JSON.stringify(body),
			}),
	};
}

afterEach(async () => {
	for (const resource of resources.splice(0)) {
		try {
			await resource.close();
		} finally {
			await rm(resource.directory, { recursive: true, force: true });
		}
	}
});

describe("#given local history #when using its HTTP entry point #then the reviewed workflow persists", () => {
	it("lists evidence, drafts without writing, and saves only after review", async () => {
		const app = await fixture();
		const timeline = await fetch(`${app.url}api/timeline`);
		expect(await timeline.json()).toMatchObject({ entries: [{ id, apps: ["Word"] }] });
		const response = await app.post("draft", { ids: [id], instruction: "Format report", consent: true });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(draft);
		await expect(readdir(join(app.directory, "skills"))).rejects.toMatchObject({ code: "ENOENT" });
		const saved = await app.post("save", draft);
		expect(saved.status, await saved.text()).toBe(200);
		const text = await readFile(join(app.directory, "skills", draft.name, "SKILL.md"), "utf8");
		expect(text).toContain(`name: "${draft.name}"`);
		const duplicate = await app.post("save", draft);
		expect(duplicate.status).toBe(400);
		expect(await readFile(join(app.directory, "skills", draft.name, "SKILL.md"), "utf8")).toBe(text);
	});

	it("rejects foreign origins and session paths before reading data", async () => {
		const app = await fixture();
		expect((await app.post("save", draft, "https://example.invalid")).status).toBe(403);
		expect((await fetch(new URL("/api/timeline", app.url))).status).toBe(403);
		await expect(readdir(join(app.directory, "skills"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("requires explicit model consent without invoking the model", async () => {
		let calls = 0;
		const app = await fixture(async () => {
			calls++;
			return JSON.stringify(draft);
		});
		for (const consent of [false, null, "", 0, "true", undefined]) {
			expect((await app.post("draft", { ids: [id], instruction: "", consent })).status).toBe(400);
		}
		expect(calls).toBe(0);
	});

	it("calibrates malformed model output against the save boundary", async () => {
		const app = await fixture(async () => '{"name":"../../escape","description":"bad","body":"bad"}');
		expect((await app.post("draft", { ids: [id], instruction: "", consent: true })).status).toBe(400);
		await expect(readdir(join(app.directory, "skills"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects generated invalid save inputs without creating a partial skill", async () => {
		const app = await fixture();
		const names = ["", ".", "..", "../escape", "/absolute", "a/b", "a\\b", "a\nb", "UPPER", "x".repeat(65)];
		for (const name of names) {
			expect((await app.post("save", { ...draft, name })).status, JSON.stringify(name)).toBe(400);
		}
		await expect(readdir(join(app.directory, "skills"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("persists a generated summary independently of the raw segments", async () => {
		const app = await fixture(async () => "Observed a synthetic report window.");
		expect((await app.post("summarize", { ids: [id], instruction: "", consent: true })).status).toBe(200);
		const summaries = join(app.directory, "cua-history", "summaries");
		const files = await readdir(summaries);
		expect(files).toHaveLength(1);
		const file = files[0];
		if (file === undefined) throw new Error("Summary was not persisted");
		expect(await readFile(join(summaries, file), "utf8")).toBe("Observed a synthetic report window.");
		const saved = await fetch(`${app.url}api/summaries`);
		expect(await saved.json()).toMatchObject({ summaries: [{ summary: "Observed a synthetic report window." }] });
	});

	it("changes automatic sharing only through an explicit setting action without starting inference", async () => {
		let calls = 0;
		const app = await fixture(async () => {
			calls++;
			return JSON.stringify(draft);
		});
		expect(await (await fetch(`${app.url}api/automation`)).json()).toMatchObject({ enabled: false });
		expect((await app.post("automation", { enabled: true })).status).toBe(200);
		expect(await (await fetch(`${app.url}api/automation`)).json()).toMatchObject({ enabled: true });
		expect((await app.post("automation", { enabled: false })).status).toBe(200);
		expect(calls).toBe(0);
	});

	it("hands a stopped demonstration's bounded evidence to the draft generator", async () => {
		let time = Date.parse("2026-10-30T10:00:30Z");
		let captured = "";
		const app = await fixture(
			async (prompt) => {
				captured = prompt;
				return JSON.stringify(draft);
			},
			() => time,
		);
		await writeFile(join(app.directory, "cua-history", "state.json"), JSON.stringify({ state: "running" }));
		const start = await app.post("record/start", {});
		expect(start.status).toBe(200);
		const marker = z.object({ id: z.uuid() }).parse(await start.json());
		time = Date.parse("2026-10-30T10:01:30Z");
		const stop = await app.post("record/stop", { id: marker.id });
		expect(stop.status).toBe(200);
		expect(await stop.json()).toMatchObject({ sourceIds: [id] });
		const generated = await app.post("draft", {
			ids: [id],
			demonstrationId: marker.id,
			instruction: "",
			consent: true,
		});
		expect(generated.status).toBe(200);
		const envelope = z
			.object({ selectedHistory: z.string() })
			.parse(JSON.parse(captured.slice(captured.indexOf('\n{"userGoal"') + 1)));
		expect(envelope.selectedHistory).toContain('"timestamp":"2026-10-30T10:01:00Z"');
		expect((await app.post("record/stop", { id: marker.id })).status).toBe(400);
	});

	it("creates a draft from a labelled saved summary after raw evidence expires", async () => {
		let captured = "";
		const app = await fixture(async (prompt) => {
			captured = prompt;
			return JSON.stringify(draft);
		});
		const summaries = join(app.directory, "cua-history", "summaries");
		await mkdir(summaries);
		await writeFile(
			join(summaries, `auto-${id}.json`),
			JSON.stringify({
				id,
				sourceIds: [id],
				title: "Report formatting",
				summary: "A heading was selected; formatting outcome was not captured.",
				suggestion: { name: "format-report", description: "Format a report heading", goal: "Bold a heading" },
			}),
		);
		await rm(join(app.directory, "cua-history", "segments"), { recursive: true });
		const response = await app.post("draft", { ids: [id], digestId: id, instruction: "", consent: true });
		expect(response.status).toBe(200);
		const envelope = z
			.object({ selectedHistory: z.string() })
			.parse(JSON.parse(captured.slice(captured.indexOf('\n{"userGoal"') + 1)));
		expect(JSON.parse(envelope.selectedHistory)).toMatchObject({
			evidenceType: "generated-summary-not-raw-events",
			id,
		});
	});
});
