/** Seeded PRNG so run order and bootstrap resamples are reproducible from the recorded seed. */
export function mulberry32(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function shuffle(array, rand) {
	const copy = [...array];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

export function wilson(successes, n, z = 1.959964) {
	if (n === 0) return { rate: null, lower: 0, upper: 1 };
	const p = successes / n;
	const denominator = 1 + (z * z) / n;
	const centre = (p + (z * z) / (2 * n)) / denominator;
	const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
	return { rate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/** Linear-interpolation quantile (Hyndman–Fan type 7, numpy's default). */
export function quantile(values, q) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const position = (sorted.length - 1) * q;
	const low = Math.floor(position);
	const high = Math.ceil(position);
	return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** Percentile 95% CI of `statistic` over blocks resampled with replacement; blocks keep their pairing. */
export function pairedBootstrap(blocks, statistic, { resamples = 10000, seed = 1 } = {}) {
	const rand = mulberry32(seed);
	const estimates = [];
	for (let r = 0; r < resamples; r++) {
		const sample = Array.from({ length: blocks.length }, () => blocks[Math.floor(rand() * blocks.length)]);
		const value = statistic(sample);
		if (Number.isFinite(value)) estimates.push(value);
	}
	return {
		estimate: statistic(blocks),
		lower: quantile(estimates, 0.025),
		upper: quantile(estimates, 0.975),
		resamples: estimates.length,
	};
}

/** Two-sided exact McNemar p-value from discordant counts. */
export function mcnemarExact(b, c) {
	const n = b + c;
	if (n === 0) return 1;
	const k = Math.min(b, c);
	let tail = 0;
	let term = 0.5 ** n;
	for (let i = 0; i <= k; i++) {
		tail += term;
		term = (term * (n - i)) / (i + 1);
	}
	return Math.min(1, 2 * tail);
}

export function decideRatioClaim({ lower, upper }, threshold = 0.75) {
	if (upper === null || lower === null) return "INCONCLUSIVE";
	if (upper <= threshold) return "PASS";
	if (lower > threshold) return "FAIL";
	return "INCONCLUSIVE";
}

export function decideNonInferiority({ lower, upper }, margin = -0.05) {
	if (upper === null || lower === null) return "INCONCLUSIVE";
	if (lower > margin) return "PASS";
	if (upper < 0) return "FAIL";
	return "INCONCLUSIVE";
}

/** Latency of an attempt for the primary analysis: failures count their elapsed time, timeouts the cap. */
export function primarySeconds(row, capSeconds) {
	return row.timed_out === true || row.agent?.timedOut === true || !Number.isFinite(row.e2e_seconds)
		? capSeconds
		: row.e2e_seconds;
}

export function summarizeRoute(rows, capSeconds) {
	const completed = rows.filter((row) => row.pass === true).length;
	const falseSuccess = rows.filter((row) => row.false_success === true).length;
	const seconds = rows.map((row) => primarySeconds(row, capSeconds));
	return {
		n: rows.length,
		completed,
		completion: wilson(completed, rows.length),
		false_success: { count: falseSuccess, wilson: wilson(falseSuccess, rows.length) },
		median: quantile(seconds, 0.5),
		p95: quantile(seconds, 0.95),
	};
}
