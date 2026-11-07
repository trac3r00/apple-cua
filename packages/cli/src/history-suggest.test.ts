import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHistorySkillCandidates } from "@opencua/core";
import { SKILL_SUGGESTIONS_FILE, formatSuggestions, menuSuggestions, writeMenuSuggestions } from "./history-suggest.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const step = (app: string, title: string) => ({
	kind: "window.changed",
	timestamp: "2026-11-01T10:00:00Z",
	app: { name: app },
	window: { title },
});
const flow = [step("Safari", "Invoice"), step("Notes", "Ledger"), step("Mail", "Draft")];
const detection = detectHistorySkillCandidates([{ id: "2026-11-01T10-00-00Z", events: [...flow, ...flow] }]);

describe("#given a detected repeat #when formatting #then the terminal list and menu items name it", () => {
	it("prints a numbered list and builds an agent prompt per menu item", () => {
		expect(formatSuggestions(detection)).toContain("1. safari-notes-mail-workflow  (repeated 2x");
		const [item] = menuSuggestions(detection);
		expect(item?.title).toBe("Mail + Notes + Safari: 3 steps, repeated 2x");
		expect(item?.prompt).toContain("cua_history_save_skill");
	});

	it("explains how to get suggestions when none exist", () => {
		expect(formatSuggestions(detectHistorySkillCandidates([]))).toContain("repeat a task at least twice");
	});
});

describe("#given a history root #when writing menu suggestions #then the file is private JSON and symlinks are refused", () => {
	it("writes 0600 JSON atomically", async () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "opencua-suggest-")));
		dirs.push(root);
		const path = await writeMenuSuggestions(root, detection);
		expect(path).toBe(join(root, SKILL_SUGGESTIONS_FILE));
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(JSON.parse(readFileSync(path, "utf8")).suggestions).toHaveLength(1);
	});

	it("refuses a symlinked root", async () => {
		const base = realpathSync(mkdtempSync(join(tmpdir(), "opencua-suggest-")));
		dirs.push(base);
		symlinkSync(base, join(base, "link"));
		await expect(writeMenuSuggestions(join(base, "link"), detection)).rejects.toThrow("real directory");
	});
});

describe("#given a description a small model wrote #when suggestions are shown #then people see what the skill does", () => {
	const id = detection.candidates[0]?.id ?? "";
	const description = {
		name: "invoice-to-ledger",
		title: "Move an invoice into the ledger",
		summary: "Opens the invoice, the ledger and a mail draft in turn.",
		whenToUse: "When an invoice arrives.",
	};

	it("titles the menu item with the description and names the skill in the agent prompt", () => {
		const [item] = menuSuggestions(detection, { [id]: description });
		expect(item?.title).toBe(`${description.title} (2x)`);
		expect(item?.prompt).toContain(description.name);
	});

	it("prints the title, summary and when to use it, and still the raw steps without one", () => {
		const described = formatSuggestions(detection, { [id]: description });
		for (const text of [description.title, description.summary, description.whenToUse])
			expect(described).toContain(text);
		expect(formatSuggestions(detection)).toContain(detection.candidates[0]?.proposedName ?? "missing");
	});
});
