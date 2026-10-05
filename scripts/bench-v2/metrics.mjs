import { readFileSync } from "node:fs";

export function accountPayload(result) {
	let text_bytes = 0;
	let image_base64_bytes = 0;
	let image_tokens = 0;
	for (const block of result?.content ?? []) {
		if (block.type === "text") text_bytes += Buffer.byteLength(block.text ?? "");
		if (block.type !== "image") continue;
		const data = block.data ?? "";
		image_base64_bytes += Buffer.byteLength(data);
		const image = Buffer.from(data, "base64");
		let width = 0;
		let height = 0;
		if (image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) && image.length >= 24) {
			width = image.readUInt32BE(16);
			height = image.readUInt32BE(20);
		} else if (image[0] === 0xff && image[1] === 0xd8) {
			let pos = 2;
			while (pos + 9 < image.length) {
				if (image[pos] !== 0xff) break;
				const marker = image[pos + 1];
				if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
					height = image.readUInt16BE(pos + 5);
					width = image.readUInt16BE(pos + 7);
					break;
				}
				const length = image.readUInt16BE(pos + 2);
				if (length < 2) break;
				pos += 2 + length;
			}
		}
		image_tokens += Math.ceil((width * height) / 750);
	}
	// Structured content is available to model-facing clients as well; count its serialized text once.
	if (result?.structuredContent !== undefined)
		text_bytes += Buffer.byteLength(JSON.stringify(result.structuredContent));
	return { text_bytes, image_base64_bytes, image_tokens, estimated_tokens: text_bytes / 4 + image_tokens };
}

export function normalizeLegacy(data, source) {
	const results = [];
	for (const [key, driver] of [
		["apple_cua", "apple"],
		["cua_driver", "cua"],
	]) {
		for (const [scenario, row] of Object.entries(data.tasks?.[key] ?? {})) {
			results.push({
				driver,
				scenario,
				pass: row.pass === true,
				seconds: row.seconds ?? null,
				calls: row.calls ?? null,
				payload_bytes: row.payload_bytes ?? null,
				text_bytes: null,
				image_base64_bytes: null,
				estimated_tokens: null,
				gave_up: null,
				false_done: null,
				human_ask: null,
				error_class: row.error ? "legacy-error" : null,
			});
		}
	}
	return [{ schema: "legacy", source, started_at: data.started_at, env: data.env ?? {}, results }];
}

export function loadReport(file) {
	const parsed = JSON.parse(readFileSync(file, "utf8"));
	return parsed.schema === "bench-v2" ? parsed : normalizeLegacy(parsed, file)[0];
}

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const percentile = (values, fraction) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = (sorted.length - 1) * fraction;
	const lower = Math.floor(rank);
	return sorted[lower] + (sorted[Math.ceil(rank)] - sorted[lower]) * (rank - lower);
};
export function aggregate(rows) {
	const groups = new Map();
	for (const row of rows) {
		const key = `${row.scenario}\u0000${row.driver}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(row);
	}
	return [...groups.values()].map((group) => {
		const values = (field) =>
			group.map((r) => r[field]).filter((value) => value !== null && value !== undefined && Number.isFinite(value));
		const eligible = group.filter((r) => !["fixture-infra", "oracle-infra"].includes(r.error_class));
		const rate = (field, source = eligible) => {
			const known = source.map((r) => r[field]).filter((v) => typeof v === "boolean");
			return known.length ? known.filter(Boolean).length / known.length : null;
		};
		return {
			driver: group[0].driver,
			scenario: group[0].scenario,
			n: group.length,
			infra: group.length - eligible.length,
			pass_rate: rate("pass"),
			disturbed_user_rate: rate(
				"disturbed_user",
				group.map((r) => ({
					disturbed_user:
						typeof r.disturbed_focus === "boolean" && typeof r.disturbed_pointer === "boolean"
							? r.disturbed_focus || r.disturbed_pointer
							: null,
				})),
			),
			p50_call_ms: percentile(
				group.flatMap((r) => r.call_ms ?? []),
				0.5,
			),
			p95_call_ms: percentile(
				group.flatMap((r) => r.call_ms ?? []),
				0.95,
			),
			calls: mean(values("calls")),
			payload_kb: mean(
				group
					.map((r) =>
						r.text_bytes !== null && r.text_bytes !== undefined
							? (r.text_bytes + r.image_base64_bytes) / 1024
							: r.payload_bytes === null || r.payload_bytes === undefined
								? null
								: r.payload_bytes / 1024,
					)
					.filter((v) => v !== null),
			),
			tokens: mean(values("estimated_tokens")),
			p50_seconds: percentile(values("seconds"), 0.5),
			gave_up_rate: rate("gave_up"),
			false_done_rate: rate("false_done"),
		};
	});
}
