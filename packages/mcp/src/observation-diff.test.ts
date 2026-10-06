import type { AXTreeElement, AppState } from "@apple-cua/core";
import { describe, expect, it } from "vitest";
import { stateResult } from "./tool-result.js";

const COLUMN_COUNT = 7;

function element(id: number, label: string): AXTreeElement {
	return {
		id,
		role: "AXStaticText",
		label,
		value: `value ${id}`,
		frame: { x: 10, y: id * 20, width: 300, height: 18 },
		actions: ["AXPress"],
		children: [id + 1, id + 2],
	};
}

function elementRange(count: number, label = "row"): AXTreeElement[] {
	return Array.from({ length: count }, (_, index) => element(index + 1, `${label} ${index + 1}`));
}

function diffState(added: number, changed: number): AppState {
	const changedEntries = elementRange(changed, "old").map((before) => ({
		before,
		after: { ...before, label: `new ${before.id}` },
	}));
	return {
		app: "Fixture",
		bundleId: "test.fixture",
		pid: 1234,
		frontmost: true,
		axAvailable: true,
		elements: [],
		treeOmitted: true,
		axChangeSummary: { added, removed: 0, changed },
		axChanges: { added: elementRange(added), removed: [], changed: changedEntries },
		screenshotBase64: "",
		screenshotWidth: 100,
		screenshotHeight: 100,
		display: { width: 100, height: 100, scaleFactor: 1 },
	};
}

function textOf(state: AppState, format: "json" | "table" | undefined): string {
	const result = stateResult(state, "token-1", format);
	return result.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

function payloadOf(text: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(text);
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("payload is not an object");
	}
	return Object.fromEntries(Object.entries(parsed));
}

function bucket(changes: unknown, name: "added" | "removed" | "changed"): unknown[] {
	if (typeof changes !== "object" || changes === null || !(name in changes)) {
		throw new Error(`axChanges has no ${name}`);
	}
	const value: unknown = Object.entries(changes).find(([key]) => key === name)?.[1];
	if (!Array.isArray(value)) {
		throw new Error(`axChanges.${name} is not an array`);
	}
	return value;
}

describe("#given a large diff-only observation #when element_format is table #then rows are bounded with exact omission counts", () => {
	const state = diffState(152, 30);

	it("writes added and changed entries as table rows with the full-tree columns", () => {
		const payload = payloadOf(textOf(state, "table"));
		const changes = payload["axChanges"];

		expect(payload["element_columns"]).toBe("id\trole\tlabel\tvalue\tframe(x,y,w,h)\tactions\tchildren");
		expect(payload).not.toHaveProperty("elements");
		const added = bucket(changes, "added");
		expect(added).toHaveLength(25);
		expect(added[0]).toBe("1\tStaticText\trow 1\tvalue 1\t10,20,300,18\tPress\t2,3");
		for (const row of added) {
			expect(String(row).split("\t")).toHaveLength(COLUMN_COUNT);
		}
		const changed = bucket(changes, "changed");
		expect(changed).toHaveLength(25);
		expect(changed[0]).toEqual({
			before: "1\tStaticText\told 1\tvalue 1\t10,20,300,18\tPress\t2,3",
			after: "1\tStaticText\tnew 1\tvalue 1\t10,20,300,18\tPress\t2,3",
		});
	});

	it("counts exactly what was left out", () => {
		const payload = payloadOf(textOf(state, "table"));

		expect(payload["axChangesOmitted"]).toEqual({ added: 127, removed: 0, changed: 5 });
	});

	it("drops the size of the observation against the full json diff", () => {
		const full = textOf(state, "json").length;
		const table = textOf(state, "table").length;
		const capped = textOf(state, undefined).length;

		expect(full).toBeGreaterThan(30_000);
		expect(table).toBeLessThan(full / 4);
		expect(capped).toBeLessThan(full / 2);
	});

	it("reports no omission when the diff fits under the cap", () => {
		const payload = payloadOf(textOf(diffState(3, 2), "table"));

		expect(bucket(payload["axChanges"], "added")).toHaveLength(3);
		expect(payload).not.toHaveProperty("axChangesOmitted");
	});
});

describe("#given a large diff-only observation #when element_format is json or unspecified", () => {
	const state = diffState(152, 30);

	it("keeps the whole diff when json is asked for explicitly", () => {
		const payload = payloadOf(textOf(state, "json"));

		expect(bucket(payload["axChanges"], "added")).toHaveLength(152);
		expect(bucket(payload["axChanges"], "changed")).toHaveLength(30);
		expect(payload).not.toHaveProperty("axChangesOmitted");
		expect(payload).not.toHaveProperty("element_columns");
	});

	it("caps each bucket of the default json diff and counts the omissions", () => {
		const payload = payloadOf(textOf(state, undefined));

		expect(bucket(payload["axChanges"], "added")).toHaveLength(25);
		expect(bucket(payload["axChanges"], "added")[0]).toMatchObject({ id: 1, label: "row 1", frame: { y: 20 } });
		expect(payload["axChangesOmitted"]).toEqual({ added: 127, removed: 0, changed: 5 });
		expect(payload).not.toHaveProperty("element_columns");
	});
});
