import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate, loadReport } from "./metrics.mjs";

const escapeHtml = (value) =>
	String(value ?? "unknown")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
const fmt = (value, suffix = "") =>
	value === null || value === undefined ? "not measured" : `${Number(value).toFixed(1)}${suffix}`;
const color = { apple: "#58d4b4", "apple-legacy": "#7f9bb3", cua: "#f4b369" };
const labels = { apple: "apple-cua", "apple-legacy": "apple-cua (legacy calls)", cua: "Cua Driver" };

function chart(rows, { title, field, max, unit, percent = false }) {
	const width = 920;
	const height = 48 + rows.length * 31;
	const bars = rows
		.map((row, index) => {
			const y = 42 + index * 31;
			const value = row[field];
			const caption = value === null ? "not measured" : fmt(percent ? value * 100 : value, unit);
			const barWidth = value === null || max === 0 ? 0 : Math.max(0, Math.min(410, (410 * value) / max));
			return `<text x="8" y="${y + 15}" class="axis">${escapeHtml(row.scenario)} · ${escapeHtml(labels[row.driver])} (n=${row.n})</text><rect x="365" y="${y}" width="410" height="20" rx="4" class="track"/><rect x="365" y="${y}" width="${barWidth}" height="20" rx="4" fill="${color[row.driver]}"/><text x="784" y="${y + 15}" class="value">${escapeHtml(caption)}</text>`;
		})
		.join("");
	const mobile = rows
		.map((row, index) => {
			const y = 8 + index * 52;
			const value = row[field];
			const caption = value === null ? "not measured" : fmt(percent ? value * 100 : value, unit);
			const size = value === null || max === 0 ? 0 : Math.max(0, Math.min(216, (216 * value) / max));
			return `<text x="8" y="${y + 12}" class="axis">${escapeHtml(row.scenario)} · ${escapeHtml(labels[row.driver])} (n=${row.n})</text><rect x="8" y="${y + 20}" width="216" height="18" rx="4" class="track"/><rect x="8" y="${y + 20}" width="${size}" height="18" rx="4" fill="${color[row.driver]}"/><text x="232" y="${y + 34}" class="value">${escapeHtml(caption)}</text>`;
		})
		.join("");
	return `<section class="panel"><h2>${escapeHtml(title)}</h2><div class="scroll"><svg class="wide" role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${width} ${height}" width="920" height="${height}">${bars}</svg><svg class="narrow" role="img" aria-label="${escapeHtml(title)} mobile" viewBox="0 0 330 ${rows.length * 52 + 14}" width="330" height="${rows.length * 52 + 14}">${mobile}</svg></div></section>`;
}

function trend(runs, { field, label, percent }) {
	const commits = new Map();
	for (const run of runs) {
		if (run.schema !== "bench-v2" || !run.env?.commit) continue;
		const commit = run.env.commit;
		if (!commits.has(commit)) commits.set(commit, { timestamp: run.started_at, rows: [] });
		commits
			.get(commit)
			.rows.push(
				...run.results.filter(
					(r) => r.driver === "apple" && !["fixture-infra", "oracle-infra"].includes(r.error_class),
				),
			);
	}
	const points = [...commits]
		.sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp))
		.map(([commit, item]) => {
			const values = item.rows.map((r) => r[field]).filter((v) => v !== null && v !== undefined);
			return {
				commit,
				n: values.length,
				value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
			};
		})
		.filter((p) => p.value !== null);
	if (!points.length)
		return `<section class="panel"><h2>${escapeHtml(label)}</h2><p>not measured - no bench-v2 commit data</p></section>`;
	const ceiling = Math.max(1, ...points.map((p) => p.value));
	const dots = points.map((p, i) => {
		const x = points.length === 1 ? 420 : 50 + (740 * i) / (points.length - 1);
		const y = 155 - (115 * p.value) / ceiling;
		return { ...p, x, y };
	});
	return `<section class="panel"><h2>${escapeHtml(label)}</h2><div class="scroll"><svg role="img" aria-label="${escapeHtml(label)}" viewBox="0 0 850 205" width="850" height="205"><line x1="50" y1="155" x2="790" y2="155" stroke="#627788"/><polyline fill="none" stroke="#58d4b4" stroke-width="3" points="${dots.map((d) => `${d.x},${d.y}`).join(" ")}"/>${dots.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="5" fill="#58d4b4"/><text x="${d.x}" y="${d.y - 12}" text-anchor="middle" class="value">${fmt(percent ? d.value * 100 : d.value, percent ? "%" : "")}</text><text x="${d.x}" y="180" text-anchor="middle" class="axis">${escapeHtml(d.commit.slice(0, 8))} (n=${d.n})</text>`).join("")}</svg></div></section>`;
}

export function renderDashboard(runs) {
	const rows = aggregate(runs.flatMap((run) => run.results ?? [])).sort(
		(a, b) => a.scenario.localeCompare(b.scenario) || a.driver.localeCompare(b.driver),
	);
	const max = (field) => Math.max(1, ...rows.map((r) => r[field] ?? 0));
	const totals = aggregate(
		runs.flatMap((run) => (run.results ?? []).map((r) => ({ ...r, scenario: "all scenarios" }))),
	);
	const charts = [
		{ title: "Success rate per scenario", field: "pass_rate", max: 1, unit: "%", percent: true },
		{ title: "Calls per task", field: "calls", max: max("calls"), unit: "" },
		{ title: "Payload KB per task (text + base64)", field: "payload_kb", max: max("payload_kb"), unit: " KB" },
		{ title: "Estimated tokens per task", field: "tokens", max: max("tokens"), unit: "" },
		{ title: "p50 driver-call seconds", field: "p50_seconds", max: max("p50_seconds"), unit: " s" },
		{ title: "Disturbed user", field: "disturbed_user_rate", max: 1, unit: "%", percent: true },
		{ title: "p50 call latency", field: "p50_call_ms", max: max("p50_call_ms"), unit: " ms" },
		{ title: "p95 call latency", field: "p95_call_ms", max: max("p95_call_ms"), unit: " ms" },
		{ title: "Gave-up rate", field: "gave_up_rate", max: 1, unit: "%", percent: true },
		{ title: "False-done rate", field: "false_done_rate", max: 1, unit: "%", percent: true },
	]
		.map((spec) => chart(rows, spec))
		.join("");
	const cleanup = runs
		.flatMap((run) => run.results ?? [])
		.reduce(
			(total, row) => ({
				closed: total.closed + (row.cleanup?.closed.length ?? 0),
				quit: total.quit + (row.cleanup?.quit.length ?? 0),
				forced: total.forced + (row.cleanup?.forced?.length ?? 0),
				leftover: total.leftover + (row.cleanup?.leftover.length ?? 0),
			}),
			{ closed: 0, quit: 0, forced: 0, leftover: 0 },
		);
	const finalLeftovers = runs.flatMap((run) => run.cleanup?.leftover ?? []);
	const env = runs
		.map(
			(run) =>
				`<tr><td>${escapeHtml(run.started_at)}</td><td>${escapeHtml(run.schema)}</td><td>${escapeHtml(run.source ?? run.env?.commit?.slice(0, 8) ?? "unknown")}</td><td>${escapeHtml(run.env?.dirty ?? "unknown")}</td><td>${escapeHtml(run.env?.macos ?? run.env?.osRelease)}</td><td>${escapeHtml(run.env?.machine ?? run.env?.cpu)}</td><td>${escapeHtml(JSON.stringify(run.env?.driver_versions ?? {}))}</td><td>${escapeHtml(run.env?.screen_locked ?? "unknown")}</td><td>${escapeHtml(run.env?.session_on_console ?? "unknown")}</td><td>${run.results?.length ?? 0}</td></tr>`,
		)
		.join("");
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>macOS driver benchmark</title><style>:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0d1825;color:#ebf4f8}body{margin:0 auto;padding:clamp(16px,3vw,48px);max-width:1200px}h1{font-size:clamp(1.8rem,4vw,3rem);margin:.2em 0}h2{font-size:1.12rem;margin:.2em 0 1em}p{color:#abbfcb;line-height:1.55}.eyebrow{color:#58d4b4;text-transform:uppercase;letter-spacing:.15em;font-size:.8rem}.panel{background:#152639;border:1px solid #30465b;border-radius:14px;padding:20px;margin:18px 0;overflow:hidden}.grid{display:grid;grid-template-columns:1fr;gap:16px}.grid .panel{margin:0}.narrow{display:none}.scroll{overflow-x:auto}.axis{font:12px system-ui;fill:#cfdee8}.value{font:12px system-ui;fill:#f6fafc}.track{fill:#284055}table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{text-align:left;padding:10px;border-bottom:1px solid #30465b;white-space:nowrap}th{color:#94c7cb}strong{color:#58d4b4}.legend{display:flex;gap:20px;flex-wrap:wrap}.swatch{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}@media(max-width:600px){.panel{padding:14px}.wide{display:none}.narrow{display:block;max-width:100%;height:auto}}</style></head><body><p class="eyebrow">Evidence / macOS / MCP stdio</p><h1>Computer-use benchmark</h1><p>Independent oracles, not driver self-reports. ${runs.length} report(s), ${runs.reduce((n, r) => n + (r.results?.length ?? 0), 0)} scenario-driver attempts. Legacy totals do not contain image splits, token estimates, or failure-claim classifications; those values remain <strong>not measured</strong>.</p>${runs.some((run) => run.env?.session_on_console === false) ? `<p><strong>Caveat:</strong> ${runs.filter((run) => run.env?.session_on_console === false).length} report(s) ran in a session that did not own the physical console (fast user switching or Screen Sharing). macOS hands every driver broken accessibility window elements there, so those success rates and token counts are not comparable to a console run; they show robustness under the same broken conditions.</p>` : ""}<p class="legend"><span><i class="swatch" style="background:${color.apple}"></i>apple-cua</span><span><i class="swatch" style="background:${color["apple-legacy"]}"></i>apple-cua (legacy calls)</span><span><i class="swatch" style="background:${color.cua}"></i>Cua Driver</span></p><section class="panel"><h2>Summary · weighted by attempt</h2><p>Swipe table horizontally to see all metrics on narrow screens.</p><div class="scroll"><table><thead><tr><th>Driver</th><th>Attempts</th><th>Infra</th><th>Pass</th><th>Disturbed user</th><th>p50 call ms</th><th>p95 call ms</th><th>Calls/task</th><th>Payload KB/task</th><th>Tokens/task</th><th>p50 seconds</th><th>Gave up</th><th>False done</th></tr></thead><tbody>${totals.map((r) => `<tr><td>${escapeHtml(labels[r.driver])}</td><td>${r.n}</td><td>${r.infra}</td><td>${fmt(r.pass_rate === null ? null : r.pass_rate * 100, "%")}</td><td>${fmt(r.disturbed_user_rate === null ? null : r.disturbed_user_rate * 100, "%")}</td><td>${fmt(r.p50_call_ms)}</td><td>${fmt(r.p95_call_ms)}</td><td>${fmt(r.calls)}</td><td>${fmt(r.payload_kb)}</td><td>${fmt(r.tokens)}</td><td>${fmt(r.p50_seconds)}</td><td>${fmt(r.gave_up_rate === null ? null : r.gave_up_rate * 100, "%")}</td><td>${fmt(r.false_done_rate === null ? null : r.false_done_rate * 100, "%")}</td></tr>`).join("")}</tbody></table></div></section><div class="grid">${charts}</div><div class="grid">${trend(runs, { field: "pass", label: "apple-cua success by commit", percent: true })}${trend(runs, { field: "estimated_tokens", label: "apple-cua tokens/task by commit", percent: false })}</div><section class="panel"><h2>Cleanup</h2><p>Per attempt: ${cleanup.closed} closed windows/tabs, ${cleanup.quit} quit apps (${cleanup.forced} forced terminations), ${cleanup.leftover} reported leftovers. Final verification: ${finalLeftovers.length} leftovers.</p>${finalLeftovers.length ? `<ul>${finalLeftovers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}</section><section class="panel"><h2>Environment and provenance</h2><div class="scroll"><table><thead><tr><th>Started</th><th>Schema</th><th>Source / commit</th><th>Dirty</th><th>macOS</th><th>Machine</th><th>Versions</th><th>Locked</th><th>On console</th><th>Attempts</th></tr></thead><tbody>${env}</tbody></table></div></section><p>Tokens = UTF-8 text bytes / 4 + ceil(image pixels / 750) per image. Payload includes base64 image characters. p50 seconds is median per-attempt total driver-call time; call latency p50/p95 pools individual calls. Infra attempts are counted separately and excluded from pass/fail rates. Disturbed user compares frontmost app and hardware cursor before the first and after the last driver call (pointer moved more than 2 pt); fixture setup activations are excluded. No model inference is measured.</p></body></html>`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const directory = resolve(".sisyphus/evidence/bench-v2");
	mkdirSync(directory, { recursive: true });
	const files = readdirSync(directory, { withFileTypes: true })
		.filter((e) => e.isFile() && e.name.endsWith(".json"))
		.map((e) => resolve(directory, e.name));
	// Runs taken while the Mac was locked measure the lock screen, not the drivers, so they stay out.
	const legacy = [".sisyphus/evidence/driver-task-shootout-2026-09-17.json"];
	const { existsSync } = await import("node:fs");
	const runs = [...files, ...legacy.filter(existsSync)].map(loadReport);
	mkdirSync("docs/bench", { recursive: true });
	writeFileSync("docs/bench/dashboard.html", renderDashboard(runs));
	process.stdout.write(
		`Dashboard: ${runs.length} reports, ${runs.reduce((n, r) => n + r.results.length, 0)} attempts\n`,
	);
}
