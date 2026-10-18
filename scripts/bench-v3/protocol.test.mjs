import assert from "node:assert/strict";
import test from "node:test";
import { probeProtocol } from "./protocol.mjs";

test("#given line protocol server #when frames fragmented and joined #then responses correlate", async () => {
	const result = await probeProtocol({
		command: process.execPath,
		args: [
			"-e",
			`
			let buffer = "";
			process.stdin.on("data", chunk => {
				buffer += chunk;
				let end;
				while ((end = buffer.indexOf("\\n")) >= 0) {
					const request = JSON.parse(buffer.slice(0, end));
					buffer = buffer.slice(end + 1);
					if (!("id" in request)) continue;
					process.stdout.write(JSON.stringify({
						jsonrpc:"2.0", id:request.id, result:{tools:[]}
					}) + "\\n");
				}
			});
		`,
		],
	});
	assert.equal(result.fragmented, true);
	assert.equal(result.coalesced, true);
	assert.equal(result.death, true);
	assert.equal(result.cancellation.responsive, true);
	assert.equal(result.cancellation.input_after_cancel, null);
});
