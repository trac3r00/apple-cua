import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { LineFramer, startSupervisor } from "./supervisor.js";

// mulberry32 seed 0x5eedc0de; attempted = executed = 500 valid stream cases.
function mulberry32(seed: number): () => number {
	let state = seed;
	return () => {
		state += 0x6d2b79f5;
		let value = Math.imul(state ^ (state >>> 15), state | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

describe("supervisor NDJSON framing FDD", () => {
	it("#given seed 0x5eedc0de and 500 message lists #when arbitrary bytes split #then independent JSON models agree", () => {
		const random = mulberry32(0x5eedc0de);
		const values = [{}, { nested: [null, true, { text: "한글é😀🧑‍💻" }] }, { text: "escaped\nline\r\nend" }];
		let executed = 0;
		for (let attempt = 0; attempt < 500; attempt++) {
			const messages = Array.from({ length: 1 + Math.floor(random() * 12) }, (_, index) => ({
				jsonrpc: "2.0",
				id: index,
				method: "tools/call",
				params: values[Math.floor(random() * values.length)],
			}));
			const lines = [...messages.map((message) => JSON.stringify(message)), "{}"];
			const oracle: unknown[] = lines.map((line) => JSON.parse(line));
			const wire = Buffer.from(`${lines.join("\n")}\n`);
			const actual: unknown[] = [];
			const rejected: number[] = [];
			const framer = new LineFramer(
				(line) => actual.push(JSON.parse(line)),
				() => rejected.push(1),
			);
			let offset = 0;
			while (offset < wire.length) {
				const size = 1 + Math.floor(random() * 67);
				framer.write(wire.subarray(offset, offset + size));
				offset += size;
			}
			framer.end();
			expect(actual).toEqual(oracle);
			expect(rejected).toEqual([]);
			executed++;
		}
		expect(executed).toBe(500);
	});

	it("#given a mid-codepoint split #when decoding each chunk naively #then the same oracle catches corruption", () => {
		const line = JSON.stringify({ text: "😀한글" });
		const wire = Buffer.from(`${line}\n`);
		const split = wire.indexOf(Buffer.from("😀")) + 1;
		const chunks = [wire.subarray(0, split), wire.subarray(split)];
		const naive: unknown = JSON.parse(chunks.map((chunk) => chunk.toString()).join(""));
		const oracle: unknown = JSON.parse(line);
		expect(naive).not.toEqual(oracle);
		const actual: unknown[] = [];
		const framer = new LineFramer(
			(text) => actual.push(JSON.parse(text)),
			() => undefined,
		);
		for (const chunk of chunks) framer.write(chunk);
		expect(actual).toEqual([oracle]);
	});

	it("#given truncated and non-JSON families #when followed by valid requests #then parse errors do not poison the stream", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		const replies: unknown[] = [];
		const forwarded: unknown[] = [];
		const outputFramer = new LineFramer(
			(line) => replies.push(JSON.parse(line)),
			() => undefined,
		);
		const childFramer = new LineFramer(
			(line) => forwarded.push(JSON.parse(line)),
			() => undefined,
		);
		output.on("data", (chunk: Buffer) => outputFramer.write(chunk));
		stdin.on("data", (chunk: Buffer) => childFramer.write(chunk));
		const handle = startSupervisor({
			input,
			output,
			log: () => undefined,
			spawnChild: () => ({ stdin, stdout, kill: () => undefined, onExit: () => () => undefined }),
		});
		try {
			const invalid = ['{"id":', '{"nested":{"x":1}', "not-json", "[", '{"text":"unfinished'];
			for (const [id, line] of invalid.entries()) {
				input.write(`${line}\n${JSON.stringify({ id, method: "ping" })}\n`);
			}
			expect(replies).toEqual(
				invalid.flatMap((_, id) => [
					{ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
					{ jsonrpc: "2.0", id, result: {} },
				]),
			);
			expect(forwarded).toEqual([]);
		} finally {
			input.end();
			await handle.done;
		}
	});

	it("#given the byte limit #when an oversized line is split #then rejects once and recovers at newline", () => {
		const lines: string[] = [];
		let rejected = 0;
		const framer = new LineFramer(
			(line) => lines.push(line),
			() => rejected++,
			4,
		);
		framer.write(Buffer.from("1234"));
		framer.write(Buffer.from("567890"));
		framer.write(Buffer.from("\n{}\n1234\n"));
		expect(rejected).toBe(1);
		expect(lines).toEqual(["{}", "1234"]);
	});
});
