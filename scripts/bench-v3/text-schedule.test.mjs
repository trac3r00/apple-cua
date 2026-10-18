import assert from "node:assert/strict";
import test from "node:test";
import { textAttemptSchedule } from "./run.mjs";

test("#given registered seeded blocks #when extending in separate artifacts #then preserve order and unique pairing", () => {
	const scenarios = ["textedit-two-windows", "textedit-multiline"];
	const routes = ["apple", "cua"];
	const full = [...textAttemptSchedule(20261009, 90, scenarios, routes)];
	const extended = [1, 31, 61].flatMap((start) => [...textAttemptSchedule(20261009, 30, scenarios, routes, start)]);
	assert.deepEqual(extended, full);
	assert.equal(new Set(extended.map((row) => `${row.iteration}:${row.scenario}:${row.route}`)).size, 360);
	assert.throws(() => [...textAttemptSchedule(1, 30, scenarios, routes, 0)], /invalid start/);
});
