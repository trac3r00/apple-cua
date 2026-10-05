import assert from "node:assert/strict";
import { test } from "node:test";
import { rtfTextIsBold, safariUrlMatches } from "./fixture.mjs";

test("#given saved RTF #when checking the marker #then only bold-on text counts", () => {
	// Given: what TextEdit writes for bold, plain, bold-then-off, and bold elsewhere.
	const bold = "{\\rtf1 \\f0\\b\\fs24 \\cf0 Marker}";
	const plain = "{\\rtf1 \\f0\\fs24 \\cf0 Marker}";
	const off = "{\\rtf1 \\b Other \\b0 Marker}";
	const words = "{\\rtf1 \\blue255 Marker}";
	// When/Then: bold only when the last toggle before the text turns bold on.
	assert.equal(rtfTextIsBold(bold, "Marker"), true);
	assert.equal(rtfTextIsBold(plain, "Marker"), false);
	assert.equal(rtfTextIsBold(off, "Marker"), false);
	assert.equal(rtfTextIsBold(words, "Marker"), false);
	assert.equal(rtfTextIsBold(bold, "Missing"), false);
});

test("#given a navigated fixture link #when checking Safari URL #then fragment is accepted but a different page is not", () => {
	// Given: the server page with an attempt-specific URL.
	const fixture = "http://127.0.0.1:12345/page?attempt=one";
	// When: Safari navigates to the destination fragment.
	const navigated = `${fixture}#destination`;
	// Then: the front tab still belongs to this exact attempt, not another one.
	assert.equal(safariUrlMatches(navigated, fixture), true);
	assert.equal(safariUrlMatches("http://127.0.0.1:12345/page?attempt=other#destination", fixture), false);
});
