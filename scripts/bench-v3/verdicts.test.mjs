import assert from "node:assert/strict";
import test from "node:test";
import { wilson } from "./stats.mjs";
import { classifyClaim, extensionTarget } from "./verdicts.mjs";

test("#given speed bounds #when judging #then use registered inclusive PASS and strict FAIL thresholds", () => {
	assert.equal(classifyClaim("S1", { lower: 0.7, upper: 0.75 }).verdict, "PASS");
	assert.equal(classifyClaim("S2", { lower: 0.751, upper: 0.9 }).verdict, "FAIL");
	assert.equal(classifyClaim("S3", { lower: 0.75, upper: 0.9 }).verdict, "INCONCLUSIVE");
	assert.equal(classifyClaim("S1", { lower: null, upper: null }).verdict, "INCONCLUSIVE");
	assert.equal(classifyClaim("S3", { lower: 0.1, upper: 0.2 }, false).verdict, "INCONCLUSIVE");
});

test("#given observed and population completion #when judging #then distinguish their evidence", () => {
	assert.equal(classifyClaim("R1", { completed: 30, n: 30 }).verdict, "PASS");
	assert.equal(classifyClaim("R1p", wilson(30, 30)).verdict, "INCONCLUSIVE");
	assert.equal(classifyClaim("R1", { completed: 28, n: 30 }).verdict, "FAIL");
	assert.equal(classifyClaim("R1p", { lower: 0.95, upper: 1 }).verdict, "PASS");
	assert.equal(classifyClaim("R1p", { lower: 0.8, upper: 0.949 }).verdict, "FAIL");
});

test("#given overlapping registered regression predicates #when judging #then do not silently choose a winner", () => {
	assert.equal(classifyClaim("R2", { lower: -0.04, upper: -0.01 }).verdict, "INCONCLUSIVE");
	assert.equal(classifyClaim("R3", { lower: -0.2, upper: -0.1 }).verdict, "FAIL");
	assert.equal(classifyClaim("R2", { lower: 0, upper: 0 }).verdict, "PASS");
});

test("#given false-success and safety evidence #when judging #then preserve strict population thresholds and unknowns", () => {
	assert.equal(classifyClaim("F1", { count: 0, n: 30 }).verdict, "PASS");
	assert.equal(classifyClaim("F1", { count: 1, n: 30 }).verdict, "FAIL");
	assert.equal(classifyClaim("F1p", { lower: 0, upper: 0.01 }).verdict, "INCONCLUSIVE");
	assert.equal(classifyClaim("F1p", { lower: 0, upper: 0.009 }).verdict, "PASS");
	assert.equal(
		classifyClaim("D1", { lower: 0, upper: 0, unintended: null, duplicates: null }).verdict,
		"INCONCLUSIVE",
	);
	assert.equal(classifyClaim("D1", { attributable_duplicate: true }).verdict, "FAIL");
	assert.equal(classifyClaim("D2", { completed: 30, n: 30, forbidden: 1 }).verdict, "FAIL");
	assert.equal(classifyClaim("D2", { completed: 28, n: 30, forbidden: 0 }).verdict, "INCONCLUSIVE");
});

test("#given an inconclusive interval #when n90 projection resolves it #then extend only through the registered sequence", () => {
	const completion = { ...wilson(30, 30), count: 30, n: 30 };
	assert.equal(extensionTarget("R1p", completion), 60);
	assert.equal(extensionTarget("R1p", { ...wilson(60, 60), count: 60, n: 60 }), 90);
	assert.equal(extensionTarget("R1p", { ...wilson(90, 90), count: 90, n: 90 }), null);
	assert.equal(extensionTarget("F1p", { ...wilson(0, 30), count: 0, n: 30 }), null);
	assert.equal(extensionTarget("S1", { lower: 0.6, upper: 0.82, estimate: 0.7, n: 30 }), null);
	assert.equal(extensionTarget("S1", { lower: 0.66, upper: 0.8, estimate: 0.71, n: 30 }), null);
	assert.equal(extensionTarget("S1", { lower: 0.64, upper: 0.76, estimate: 0.7, n: 30 }), 60);
	assert.equal(extensionTarget("R1p", completion, false), null);
});
