import assert from "node:assert/strict";
import test from "node:test";
import {
	decideNonInferiority,
	decideRatioClaim,
	mcnemarExact,
	mulberry32,
	pairedBootstrap,
	primarySeconds,
	quantile,
	shuffle,
	summarizeRoute,
	wilson,
} from "./stats.mjs";

const near = (actual, expected, digits = 3) => assert.equal(actual.toFixed(digits), expected.toFixed(digits));

test("#given nested agent timeout telemetry #when analyzing latency #then timeout contributes exactly the cap", () => {
	assert.equal(primarySeconds({ agent: { timedOut: true }, e2e_seconds: 301.4 }, 300), 300);
	assert.equal(primarySeconds({ agent: { timedOut: false }, e2e_seconds: 4.2 }, 300), 4.2);
	assert.equal(primarySeconds({ timed_out: true, e2e_seconds: 2 }, 300), 300);
});

test("#given 0, 15 and 30 successes of 30 #when computing Wilson intervals #then they match reference values", () => {
	near(wilson(0, 30).upper, 0.1135);
	near(wilson(30, 30).lower, 0.8865);
	near(wilson(15, 30).lower, 0.3315);
	near(wilson(15, 30).upper, 0.6685);
	assert.deepEqual(wilson(0, 0), { rate: null, lower: 0, upper: 1 });
});

test("#given four values #when taking type-7 quantiles #then they interpolate like numpy", () => {
	assert.equal(quantile([4, 1, 3, 2], 0.5), 2.5);
	near(quantile([1, 2, 3, 4], 0.95), 3.85, 6);
	assert.equal(quantile([], 0.5), null);
	assert.equal(quantile([Number.NaN, 5], 0.5), 5);
});

test("#given discordant counts #when running exact McNemar #then p-values match the binomial", () => {
	near(mcnemarExact(0, 6), 0.03125, 6);
	assert.equal(mcnemarExact(3, 3), 1);
	assert.equal(mcnemarExact(0, 0), 1);
});

test("#given the same seed #when shuffling and bootstrapping #then results repeat and stay a permutation", () => {
	const items = Array.from({ length: 20 }, (_, i) => i);
	const a = shuffle(items, mulberry32(7));
	assert.deepEqual(a, shuffle(items, mulberry32(7)));
	assert.deepEqual(
		[...a].sort((x, y) => x - y),
		items,
	);
	const mean = (blocks) => blocks.reduce((sum, value) => sum + value, 0) / blocks.length;
	const first = pairedBootstrap(items, mean, { resamples: 2000, seed: 3 });
	assert.deepEqual(first, pairedBootstrap(items, mean, { resamples: 2000, seed: 3 }));
	assert.ok(first.lower <= first.estimate && first.estimate <= first.upper);
});

test("#given CI bounds at the thresholds #when deciding claims #then boundaries follow the preregistered rules", () => {
	assert.equal(decideRatioClaim({ lower: 0.5, upper: 0.75 }), "PASS");
	assert.equal(decideRatioClaim({ lower: 0.76, upper: 0.9 }), "FAIL");
	assert.equal(decideRatioClaim({ lower: 0.7, upper: 0.8 }), "INCONCLUSIVE");
	assert.equal(decideNonInferiority({ lower: -0.04, upper: 0.1 }), "PASS");
	assert.equal(decideNonInferiority({ lower: -0.3, upper: -0.01 }), "FAIL");
	assert.equal(decideNonInferiority({ lower: -0.1, upper: 0.1 }), "INCONCLUSIVE");
});

test("#given a timed-out and a failed row #when summarizing a route #then both count in latency and completion", () => {
	const rows = [
		...Array.from({ length: 18 }, () => ({ pass: true, e2e_seconds: 1 })),
		{ pass: false, e2e_seconds: 4, false_success: true },
		{ pass: false, e2e_seconds: 2, timed_out: true },
	];
	const summary = summarizeRoute(rows, 300);
	assert.equal(summary.n, 20);
	assert.equal(summary.completed, 18);
	assert.equal(summary.false_success.count, 1);
	assert.equal(summary.median, 1);
	assert.ok(summary.p95 > 4, "the timed-out attempt counts at the cap");
});
