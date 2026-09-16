#!/usr/bin/env node

import {
	findRunningApp,
	getRunningMacOSApps,
	getRunningMacOSAppsWithJxa,
} from "../packages/core/dist/platform/app-list.js";

const WARM_RUNS = 10;
const TARGET_BUNDLE_ID = "com.apple.finder";

async function measure(operation, validate) {
	const values = [];
	for (let run = 0; run < WARM_RUNS; run += 1) {
		const started = performance.now();
		const result = await operation();
		values.push(performance.now() - started);
		validate(result);
	}
	return values;
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function printMeasurement(label, values) {
	process.stdout.write(
		`${label} median (${WARM_RUNS}): ${median(values).toFixed(2)} ms [${values
			.map((value) => value.toFixed(2))
			.join(", ")} ]\n`,
	);
}

function requireApplications(applications) {
	if (!Array.isArray(applications) || applications.length === 0) {
		throw new Error("application enumeration returned no applications");
	}
}

function requireFinder(application) {
	if (application?.bundleId !== TARGET_BUNDLE_ID || !Number.isSafeInteger(application.pid) || application.pid <= 0) {
		throw new Error(`single-app lookup did not find ${TARGET_BUNDLE_ID}`);
	}
}

await getRunningMacOSAppsWithJxa();
await getRunningMacOSApps();
await findRunningApp(TARGET_BUNDLE_ID);

const oldJxaRuns = await measure(getRunningMacOSAppsWithJxa, requireApplications);
const newEnumerationRuns = await measure(getRunningMacOSApps, requireApplications);
const singleLookupRuns = await measure(() => findRunningApp(TARGET_BUNDLE_ID), requireFinder);

const oldMedian = median(oldJxaRuns);
const newMedian = median(newEnumerationRuns);
const singleMedian = median(singleLookupRuns);

printMeasurement("Old JXA enumeration", oldJxaRuns);
printMeasurement("New AppKit enumeration", newEnumerationRuns);
printMeasurement("Single-app lookup", singleLookupRuns);
process.stdout.write(
	`New enumeration faster: ${newMedian < oldMedian ? "yes" : "no"} (${(oldMedian / newMedian).toFixed(1)}x)\n`,
);
process.stdout.write(`Single lookup vs old: ${(oldMedian / singleMedian).toFixed(1)}x faster\n`);
