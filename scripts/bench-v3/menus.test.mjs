import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireMenuLock, menuPlan, parseMenuOptions } from "./menus-run.mjs";

test("#given another suite owns the shared lock #when menu trials start #then overlap is refused", () => {
	const root = mkdtempSync(join(tmpdir(), "menus-lock-test-"));
	const path = join(root, ".run.lock");
	const owner = openSync(path, "wx");
	try {
		assert.throws(() => acquireMenuLock(root), { code: "EEXIST" });
	} finally {
		closeSync(owner);
		rmSync(path);
	}
	try {
		const acquired = acquireMenuLock(root);
		assert.equal(acquired.path, path);
		closeSync(acquired.fd);
		assert.throws(() => acquireMenuLock(root), { code: "EEXIST" });
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("#given no options #when parsing menu run #then use paired n30 defaults", () => {
	assert.deepEqual(parseMenuOptions([]), {
		runs: 30,
		seed: 20261009,
		scenarios: ["textedit-save-sheet", "textedit-alert-dismiss", "textedit-rich-bold"],
		routes: ["apple", "cua"],
	});
});

test("#given seeded custom options #when parsing menu run #then retain scenario and route order", () => {
	assert.deepEqual(
		parseMenuOptions([
			"--runs",
			"4",
			"--seed",
			"19",
			"--scenarios",
			"textedit-rich-bold,textedit-alert-dismiss",
			"--drivers",
			"cua,apple",
		]),
		{
			runs: 4,
			seed: 19,
			scenarios: ["textedit-rich-bold", "textedit-alert-dismiss"],
			routes: ["cua", "apple"],
		},
	);
});

test("#given invalid selections #when parsing menu run #then reject unsupported or duplicate inputs", () => {
	for (const args of [
		["--runs", "0"],
		["--seed", "x"],
		["--scenarios", "unknown"],
		["--scenarios", "textedit-rich-bold,textedit-rich-bold"],
		["--drivers", "apple,apple"],
		["--runs"],
	])
		assert.throws(() => parseMenuOptions(args));
});

test("#given each scenario #when building its plan #then include its defining menu task", () => {
	const save = menuPlan("textedit-save-sheet");
	assert.equal(save.at(-1).value, "Return");
	assert.ok(save.some((step) => step.value === "saved-from-sheet"));
	const alert = menuPlan("textedit-alert-dismiss");
	assert.ok(alert.some((step) => step.op === "assert-text"));
	assert.equal(alert.at(-1).value, "Escape");
	const bold = menuPlan("textedit-rich-bold");
	assert.deepEqual(bold.find((step) => step.op === "menu").path, ["Format", "Font", "Bold"]);
	assert.equal(bold.find((step) => step.op === "menu").keyboard[0].apple, "cmd+b");
	assert.throws(() => menuPlan("unsupported"));
});
