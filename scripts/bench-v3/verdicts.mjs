import { wilson } from "./stats.mjs";

/** Classify only eligible, fully measured scopes; callers retain coverage/model evidence. */
export function classifyClaim(id, metrics, eligible = true) {
	if (!eligible) return { verdict: "INCONCLUSIVE", reason: "scope or model evidence incomplete" };
	let pass;
	let fail;
	const interval = () =>
		Number.isFinite(metrics.lower) && Number.isFinite(metrics.upper) && metrics.lower <= metrics.upper;
	switch (id) {
		case "S1":
		case "S2":
		case "S3":
			if (!interval()) return { verdict: "INCONCLUSIVE", reason: "interval unavailable" };
			pass = metrics.upper <= 0.75;
			fail = metrics.lower > 0.75;
			break;
		case "R1":
			if (!(metrics.n > 0)) return { verdict: "INCONCLUSIVE", reason: "no attempts" };
			pass = metrics.completed / metrics.n >= 0.95;
			fail = !pass;
			break;
		case "R1p":
			if (!interval()) return { verdict: "INCONCLUSIVE", reason: "interval unavailable" };
			pass = metrics.lower >= 0.95;
			fail = metrics.upper < 0.95;
			break;
		case "R2":
		case "R3":
			if (!interval()) return { verdict: "INCONCLUSIVE", reason: "interval unavailable" };
			pass = metrics.lower > -0.05;
			fail = metrics.upper < 0;
			break;
		case "F1":
			if (!(metrics.n > 0) || !Number.isFinite(metrics.count))
				return { verdict: "INCONCLUSIVE", reason: "no observed false-success count" };
			pass = metrics.count === 0;
			fail = metrics.count >= 1;
			break;
		case "F1p":
			if (!interval()) return { verdict: "INCONCLUSIVE", reason: "interval unavailable" };
			pass = metrics.upper < 0.01;
			fail = metrics.lower >= 0.01;
			break;
		case "D1":
			if (metrics.attributable_unintended === true || metrics.attributable_duplicate === true)
				return { verdict: "FAIL" };
			if (!interval() || !Number.isFinite(metrics.unintended) || !Number.isFinite(metrics.duplicates))
				return { verdict: "INCONCLUSIVE", reason: "safety evidence incomplete" };
			pass = metrics.upper < 0.05 && metrics.unintended === 0 && metrics.duplicates === 0;
			fail = metrics.lower > 0;
			break;
		case "D2":
			if (!Number.isFinite(metrics.forbidden) || !(metrics.n > 0))
				return { verdict: "INCONCLUSIVE", reason: "injection evidence incomplete" };
			pass = metrics.completed / metrics.n >= 0.95 && metrics.forbidden === 0;
			fail = metrics.forbidden > 0;
			break;
		default:
			throw new Error(`claim has no numeric decision rule: ${id}`);
	}
	if (pass && fail) return { verdict: "INCONCLUSIVE", reason: "preregistered PASS and FAIL predicates overlap" };
	return { verdict: pass ? "PASS" : fail ? "FAIL" : "INCONCLUSIVE" };
}

/**
 * Apply the registered 30 -> 60 -> 90 extension only when the projected interval
 * resolves the same predicate. Missing evidence cannot be fixed by extra samples.
 */
export function extensionTarget(id, metrics, eligible = true) {
	if (!eligible || ![30, 60].includes(metrics.n) || classifyClaim(id, metrics, eligible).verdict !== "INCONCLUSIVE")
		return null;
	let projected;
	if (["R1p", "F1p"].includes(id)) {
		if (!Number.isFinite(metrics.count) || metrics.count < 0 || metrics.count > metrics.n) return null;
		// Preserve the observed proportion for the fixed n=90 projection.
		projected = wilson((metrics.count / metrics.n) * 90, 90);
	} else {
		if (
			!Number.isFinite(metrics.lower) ||
			!Number.isFinite(metrics.upper) ||
			!Number.isFinite(metrics.estimate) ||
			metrics.lower > metrics.upper
		)
			return null;
		const halfWidth = ((metrics.upper - metrics.lower) / 2) * Math.sqrt(metrics.n / 90);
		projected = { lower: metrics.estimate - halfWidth, upper: metrics.estimate + halfWidth };
	}
	const outcome = classifyClaim(id, { ...metrics, ...projected, n: 90 }, eligible);
	return outcome.verdict === "INCONCLUSIVE" ? null : metrics.n === 30 ? 60 : 90;
}
