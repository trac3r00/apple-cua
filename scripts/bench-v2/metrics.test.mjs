import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderDashboard } from "./dashboard.mjs";
import { accountPayload, aggregate, normalizeLegacy } from "./metrics.mjs";

test("#given text and a 300x150 PNG #when accounting #then bytes and image tokens are distinct", () => {
	const png = Buffer.alloc(24);
	Buffer.from("89504e470d0a1a0a", "hex").copy(png);
	png.writeUInt32BE(300, 16);
	png.writeUInt32BE(150, 20);
	assert.deepEqual(
		accountPayload({
			content: [
				{ type: "text", text: "é" },
				{ type: "image", mimeType: "image/png", data: png.toString("base64") },
			],
		}),
		{ text_bytes: 2, image_base64_bytes: 32, image_tokens: 60, estimated_tokens: 60.5 },
	);
});

test("#given two runs with one failure #when aggregating #then rates and p50 use actual denominators", () => {
	const rows = [
		{
			driver: "apple",
			scenario: "save",
			pass: true,
			seconds: 2,
			calls: 2,
			text_bytes: 100,
			image_base64_bytes: 0,
			estimated_tokens: 25,
			gave_up: false,
			false_done: false,
		},
		{
			driver: "apple",
			scenario: "save",
			pass: false,
			seconds: 4,
			calls: 4,
			text_bytes: 300,
			image_base64_bytes: 0,
			estimated_tokens: 75,
			gave_up: true,
			false_done: true,
		},
	];
	assert.deepEqual(aggregate(rows), [
		{
			driver: "apple",
			scenario: "save",
			n: 2,
			pass_rate: 0.5,
			calls: 3,
			payload_kb: 200 / 1024,
			tokens: 50,
			p50_seconds: 3,
			gave_up_rate: 0.5,
			false_done_rate: 0.5,
			infra: 0,
			disturbed_user_rate: null,
			p50_call_ms: null,
			p95_call_ms: null,
		},
	]);
});

test("#given infra and timed calls #when aggregating #then only driver outcomes count as pass/fail", () => {
	// Given: a driver pass, failure and an oracle read error with measured motion.
	const rows = [
		{
			driver: "apple",
			scenario: "safari",
			pass: true,
			error_class: null,
			call_ms: [10, 20],
			disturbed_focus: false,
			disturbed_pointer: false,
		},
		{
			driver: "apple",
			scenario: "safari",
			pass: false,
			error_class: "oracle-mismatch",
			call_ms: [30],
			disturbed_focus: true,
			disturbed_pointer: false,
		},
		{
			driver: "apple",
			scenario: "safari",
			pass: false,
			error_class: "oracle-infra",
			call_ms: [40],
			disturbed_focus: false,
			disturbed_pointer: true,
		},
	];
	// When: the results are summarized.
	const [summary] = aggregate(rows);
	// Then: infra is separate while latency and disturbance cover measured calls/attempts.
	assert.equal(summary.n, 3);
	assert.equal(summary.infra, 1);
	assert.equal(summary.pass_rate, 0.5);
	assert.equal(summary.disturbed_user_rate, 2 / 3);
	assert.equal(summary.p50_call_ms, 25);
	assert.equal(summary.p95_call_ms, 38.5);
	const html = renderDashboard([{ schema: "bench-v2", results: rows }]);
	assert.match(html, /<th>Infra<\/th>/);
	assert.match(html, /<th>Disturbed user<\/th>/);
	assert.match(html, /<th>p95 call ms<\/th>/);
	assert.match(html, /66\.7%/);
});

test("#given cleanup leftovers #when rendering #then the dashboard reports them without HTML injection", () => {
	// Given: cleanup could not close a fixture window.
	const report = {
		schema: "bench-v2",
		results: [
			{ driver: "apple", scenario: "save", pass: false, cleanup: { closed: [], quit: [], leftover: ["<window>"] } },
		],
		cleanup: { closed: [], quit: [], leftover: ["<window>"] },
	};
	// When: the report is rendered.
	const html = renderDashboard([report]);
	// Then: the leftover is visible but escaped.
	assert.match(html, /Final verification: 1 leftovers/);
	assert.match(html, /&lt;window&gt;/);
	assert.doesNotMatch(html, /<li><window><\/li>/);
});

test("#given legacy results #when normalizing #then unknown image and token metrics remain unknown", () => {
	const rows = normalizeLegacy(
		{
			started_at: "2026-09-17T00:00:00Z",
			tasks: { apple_cua: { save: { pass: true, calls: 2, payload_bytes: 500, seconds: 2 } } },
		},
		"legacy.json",
	);
	assert.deepEqual(
		{
			driver: rows[0].results[0].driver,
			scenario: rows[0].results[0].scenario,
			estimated_tokens: rows[0].results[0].estimated_tokens,
			payload_bytes: rows[0].results[0].payload_bytes,
		},
		{ driver: "apple", scenario: "save", estimated_tokens: null, payload_bytes: 500 },
	);
});

test("#given a legacy fixture #when rendering #then charts label n and omit unknown tokens", () => {
	const runs = normalizeLegacy(
		{
			started_at: "2026-09-17T00:00:00Z",
			tasks: { apple_cua: { save: { pass: true, calls: 2, payload_bytes: 500, seconds: 2 } } },
		},
		"legacy.json",
	);
	const html = renderDashboard(runs);
	assert.match(html, /save/);
	assert.match(html, /n=1/);
	assert.match(html, /not measured/);
	assert.doesNotMatch(html, /cdn\./);
});

test("#given a fixture JSON report #when aggregating and rendering #then v2 metrics and commit trend are visible", () => {
	const fixture = JSON.parse(readFileSync(new URL("./fixtures/report.json", import.meta.url), "utf8"));
	const rows = aggregate(fixture.results);
	assert.equal(rows.find((row) => row.driver === "apple").tokens, 130);
	const html = renderDashboard([fixture]);
	assert.match(html, /abc12345 \(n=1\)/);
	assert.match(html, /textedit-fill-save/);
	assert.match(html, /Gave-up rate/);
});

test("#given hostile fixture text #when rendering #then no HTML injection survives", () => {
	const html = renderDashboard(
		normalizeLegacy(
			{
				started_at: "2026-09-17",
				tasks: {
					apple_cua: { "<script>alert(1)</script>": { pass: false, calls: 1, payload_bytes: 1, seconds: 1 } },
				},
			},
			"x",
		),
	);
	assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});
