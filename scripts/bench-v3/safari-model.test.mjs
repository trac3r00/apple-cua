import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { safariModelRowExpression } from "./remaining-driver-run.mjs";

test("#given a retired Safari model with absent tabs #when serializing its counts #then reports zero rather than coerced text length", () => {
	const script = `tell application "Safari"
set w to {id:6601, visible:false, tabs:missing value}
return ${safariModelRowExpression}
end tell`;
	const result = execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10000 }).trim();
	assert.equal(result, "6601:false:0");
});
