import assert from "node:assert/strict";
import test from "node:test";
import { fixturePage, startPages } from "./pages.mjs";

test(
	"#given a subscribed oracle #when the attempt ends #then cancellation releases it",
	{ timeout: 1000 },
	async () => {
		const server = await startPages();
		try {
			const controller = new AbortController();
			const outcome = server.waitFor(`${server.base}/page?attempt=cancel`, () => false, 10000, controller.signal);
			controller.abort();
			assert.equal(await outcome, false);
		} finally {
			await server.close();
		}
	},
);

test("#given unique attempt pages #when state arrives #then oracle isolates attempts", async () => {
	const server = await startPages();
	try {
		const first = `${server.base}/page?attempt=1`;
		const second = `${server.base}/page?attempt=2`;
		const signal = server.waitFor(first, (state) => state?.field === "marker");
		const state = { page: first, nonce: "n", sequence: 0, field: "marker", hash: "", ready: true, forbidden: 0 };
		assert.equal(
			(
				await fetch(`${server.base}/state`, {
					method: "POST",
					body: JSON.stringify(state),
				})
			).status,
			204,
		);
		assert.equal(await signal, true);
		assert.equal(server.state(second), undefined);
		assert.equal(server.state(first).forbidden, 0);
	} finally {
		await server.close();
	}
});

test("#given invalid fixture kind #when rendering #then fails explicitly", () => {
	assert.throws(() => fixturePage("unknown"), /unknown page/);
});

test("#given a complete input report #when an older prefix arrives later #then the oracle retains the newest page event", async () => {
	const server = await startPages();
	try {
		const state = {
			page: `${server.base}/page?attempt=ordered`,
			nonce: "owned",
			field: "marker",
			hash: "",
			ready: true,
			forbidden: 0,
			sequence: 2,
		};
		for (const report of [state, { ...state, field: "marke", sequence: 1 }]) {
			const response = await fetch(`${server.base}/state`, {
				method: "POST",
				body: JSON.stringify(report),
				signal: AbortSignal.timeout(1000),
			});
			assert.equal(response.status, 204);
		}
		assert.equal(server.state(state.page).field, "marker");
	} finally {
		await server.close();
	}
});

test(
	"#given an invalid HTTP fixture request #when rejecting it #then the server remains responsive",
	{ timeout: 3000 },
	async () => {
		const server = await startPages();
		try {
			const rejected = await fetch(`${server.base}/page?kind=unknown`, { signal: AbortSignal.timeout(1000) });
			assert.equal(rejected.status, 400);
			const valid = await fetch(`${server.base}/page?kind=form`, { signal: AbortSignal.timeout(1000) });
			assert.equal(valid.status, 200);
		} finally {
			await server.close();
		}
	},
);
