import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_HEADING } from "./fixture.mjs";
import { safariMatches, startOracleServer } from "./oracle-server.mjs";

test("#given a local page #when it reports load and input #then the server records rendered state", async () => {
	const server = await startOracleServer();
	try {
		// Given: a served page and a listener registered before its report.
		const page = await fetch(server.url);
		assert.equal(page.status, 200);
		assert.match(await page.text(), /addEventListener\('input', report\)/);
		const reported = server.waitFor((state) => state?.field === "typed");
		// When: the page posts its measured state.
		const response = await fetch(new URL("/state", server.url), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				page: server.url,
				nonce: "load-2",
				field: "typed",
				hash: "#destination",
				heading: PAGE_HEADING,
			}),
		});
		// Then: the server and oracle both see the same reported values.
		assert.equal(response.status, 204);
		assert.equal(await reported, true);
		assert.equal(safariMatches("safari-field", "typed", server.state, "load-1"), true);
		assert.equal(safariMatches("safari-link", null, server.state, "load-1"), true);
		assert.equal(safariMatches("safari-heading", null, server.state, "load-1"), true);
		assert.equal(safariMatches("safari-heading", null, server.state, "load-2"), false);
		assert.equal(safariMatches("safari-field", "other", server.state, "load-1"), false);
	} finally {
		await server.close();
	}
});
