import { describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import { vi, whenSettled } from "@apple-cua/test-support";
import { windowsGuestDisplay } from "./utm-guest.js";

describe("#given a guest process #when its completed display query is read #then dimensions are parsed", () => {
	it("preserves the original error as cause when cleanup transport fails", async () => {
		const stopped = new Error("stopped");
		let calls = 0;
		await expect(
			windowsGuestDisplay(
				async () => {
					if (++calls === 1) return "42";
					throw stopped;
				},
				"const v = {};",
				undefined,
				async () => {
					throw new Error("transport");
				},
			),
		).rejects.toMatchObject({ cause: stopped, message: "Guest query cleanup failed: transport" });
	});

	it("preserves the stop when the query exited before taskkill", async () => {
		const stopped = new Error("stopped");
		let calls = 0;
		let cleaning = 0;
		await expect(
			windowsGuestDisplay(
				async () => {
					if (++calls === 1) return "42";
					throw stopped;
				},
				"const v = {};",
				undefined,
				async () => {
					if (++cleaning === 1) return "99";
					return JSON.stringify({ exited: true, exitCode: 1 });
				},
			),
		).rejects.toBe(stopped);
		expect(cleaning).toBe(3);
	});
	it("reads output from a stable guest process identity", async () => {
		const scripts: string[] = [];
		const size = await windowsGuestDisplay(async (body) => {
			scripts.push(body);
			return scripts.length === 1
				? "42"
				: JSON.stringify({ exited: true, exitCode: 0, outputText: "1920x1080\r\n" });
		}, "const v = {};");
		expect(size).toEqual({ width: 1920, height: 1080 });
		expect(scripts[1]).toContain("guestProcesses.byId(42)");
	});

	it.each(["0x768", "1024x0", "bad", "1920x1080\nunexpected"])(
		"rejects malformed guest dimensions %j",
		async (text) => {
			let call = 0;
			await expect(
				windowsGuestDisplay(async () => {
					call++;
					return call === 1 ? "42" : JSON.stringify({ exited: true, exitCode: 0, outputText: text });
				}, "const v = {};"),
			).rejects.toThrow("invalid display dimensions");
		},
	);

	it("propagates guest failures instead of inventing dimensions", async () => {
		let call = 0;
		await expect(
			windowsGuestDisplay(async () => {
				call++;
				return call === 1 ? "42" : JSON.stringify({ exited: true, exitCode: 2, outputText: "" });
			}, "const v = {};"),
		).rejects.toThrow("Guest display query failed");
	});

	it("captures separate outer streams through the same process identity without killing an exited query", async () => {
		const execute = vi.fn((..._invocation: readonly unknown[]) => ({ id: () => 42 }));
		const byId = vi.fn((id: number) => id);
		const getResult = vi.fn(() => ({
			exited: true,
			exitCode: 1,
			outputText: "child.stdout: compiler output",
			errorText: "child.stderr: stage=child-add-type; access denied",
		}));
		const cleanup = vi.fn();
		const result = windowsGuestDisplay(
			async (body) =>
				String(
					runInNewContext(`(function(){${body}})()`, {
						u: { execute, getResult },
						v: { guestProcesses: { byId } },
					}),
				),
			"",
			undefined,
			cleanup,
		);
		const error = await result.catch((error: unknown) => error);
		expect(error).toBeInstanceOf(Error);
		if (!(error instanceof Error)) throw new Error("Expected a completed-query error");
		const diagnostics: unknown = JSON.parse(error.message.slice(error.message.indexOf('{"stdout":')));
		expect(diagnostics).toEqual({
			stdout: { text: "child.stdout: compiler output", truncated: false },
			stderr: { text: "child.stderr: stage=child-add-type; access denied", truncated: false },
		});
		expect(execute.mock.calls[0]).toEqual([
			expect.any(Object),
			{
				at: "powershell.exe",
				withArguments: ["-NoProfile", "-EncodedCommand", expect.any(String)],
				outputCapturing: true,
			},
		]);
		expect(byId).toHaveBeenCalledTimes(1);
		expect(byId).toHaveBeenCalledWith(42);
		expect(getResult).toHaveBeenCalledTimes(1);
		expect(getResult).toHaveBeenCalledWith(42);
		expect(cleanup).not.toHaveBeenCalled();
	});

	it("bounds and escapes untrusted streams without treating their contents as log structure", async () => {
		const text = `"\n\u001b[31m\u0000\u202e${"x".repeat(5000)}`;
		let call = 0;
		const error = await windowsGuestDisplay(async () => {
			if (++call === 1) return "42";
			return JSON.stringify({ exited: true, exitCode: 1, outputText: text, errorText: text });
		}, "const v = {};").catch((error: unknown) => error);
		if (!(error instanceof Error)) throw new Error("Expected a completed-query error");
		const diagnostics: unknown = JSON.parse(error.message.slice(error.message.indexOf('{"stdout":')));
		expect(diagnostics).toEqual({
			stdout: { text: text.slice(0, 2048), truncated: true },
			stderr: { text: text.slice(0, 2048), truncated: true },
		});
		expect([...error.message].every((character) => character.charCodeAt(0) >= 32)).toBe(true);
		expect(error.message).toContain("\\u202e");
		expect(error.message.length).toBeLessThan(26_000);
		expect(call).toBe(2);
	});

	it.each([
		[0x061c, "\\u061c"],
		[0x200e, "\\u200e"],
		[0x200f, "\\u200f"],
	] as const)("quotes bidi control %i from generated JXA failure results as %s", async (codePoint, escaped) => {
		const control = String.fromCodePoint(codePoint);
		const stdout = `out:${control}:end`;
		const stderr = `err:${control}:end`;
		const error = await windowsGuestDisplay(
			async (body) =>
				String(
					runInNewContext(`(function(){${body}})()`, {
						u: {
							execute: () => ({ id: () => 42 }),
							getResult: () => ({ exited: true, exitCode: 1, outputText: stdout, errorText: stderr }),
						},
						v: { guestProcesses: { byId: (id: number) => id } },
					}),
				),
			"",
		).catch((error: unknown) => error);
		if (!(error instanceof Error)) throw new Error("Expected a completed-query error");
		expect(error.message).toContain(`"stdout":{"text":"out:${escaped}:end","truncated":false}`);
		expect(error.message).toContain(`"stderr":{"text":"err:${escaped}:end","truncated":false}`);
		expect(error.message).not.toContain(control);
		const diagnostics: unknown = JSON.parse(error.message.slice(error.message.indexOf('{"stdout":')));
		expect(diagnostics).toEqual({
			stdout: { text: stdout, truncated: false },
			stderr: { text: stderr, truncated: false },
		});
	});

	it.each([undefined, 12, null, { message: "not text" }])(
		"reports unavailable streams without coercing untrusted values %j",
		async (stream) => {
			let call = 0;
			const error = await windowsGuestDisplay(async () => {
				if (++call === 1) return "42";
				return JSON.stringify({ exited: true, exitCode: 1, outputText: stream, errorText: stream });
			}, "const v = {};").catch((error: unknown) => error);
			if (!(error instanceof Error)) throw new Error("Expected a completed-query error");
			const diagnostics: unknown = JSON.parse(error.message.slice(error.message.indexOf('{"stdout":')));
			expect(diagnostics).toEqual({ stdout: null, stderr: null });
		},
	);

	it("does not mix successful stderr into dimensions", async () => {
		let call = 0;
		const size = await windowsGuestDisplay(async () => {
			if (++call === 1) return "42";
			return JSON.stringify({ exited: true, exitCode: 0, outputText: "1024x768\r\n", errorText: "diagnostic" });
		}, "const v = {};");
		expect(size).toEqual({ width: 1024, height: 768 });
	});

	it("decodes child diagnostics before applying the reviewed outer quoting and bounds", async () => {
		const text = 'Compiler error "\n\u001b[31m\u202e';
		const body = Buffer.concat([Buffer.from([1, 1, 1]), Buffer.from(text)]);
		const header = Buffer.alloc(4);
		header.writeUInt32LE(body.length);
		const outputText = `CUA1:${Buffer.concat([header, body]).toString("base64")}:1\r\n`;
		let calls = 0;
		const error = await windowsGuestDisplay(async () => {
			if (++calls === 1) return "42";
			return JSON.stringify({ exited: true, exitCode: 1, outputText, errorText: "outer progress" });
		}, "const v = {};").catch((error: unknown) => error);
		if (!(error instanceof Error)) throw new Error("Expected a completed-query error");
		const diagnostics: unknown = JSON.parse(error.message.slice(error.message.indexOf('{"stdout":')));
		expect(diagnostics).toEqual({
			stdout: {
				text: `stage=child-add-type; childExit=1; errorTruncated=true; error=${text}`,
				truncated: false,
			},
			stderr: { text: "outer progress", truncated: false },
		});
		expect([...error.message].every((character) => character.charCodeAt(0) >= 32)).toBe(true);
		expect(error.message).toContain("\\u202e");
		expect(calls).toBe(2);
	});

	it("rejects a diagnostic envelope even when the outer process reports success", async () => {
		let calls = 0;
		await expect(
			windowsGuestDisplay(async () => {
				if (++calls === 1) return "42";
				return JSON.stringify({ exited: true, exitCode: 0, outputText: "CUA1:AwAAAAEBAA==:1" });
			}, "const v = {};"),
		).rejects.toThrow("invalid display dimensions");
	});

	it("keeps the per-stream boundary inclusive", async () => {
		let call = 0;
		const error = await windowsGuestDisplay(async () => {
			if (++call === 1) return "42";
			return JSON.stringify({ exited: true, exitCode: 1, outputText: "x".repeat(2048), errorText: "" });
		}, "const v = {};").catch((error: unknown) => error);
		if (!(error instanceof Error)) throw new Error("Expected a completed-query error");
		const diagnostics: unknown = JSON.parse(error.message.slice(error.message.indexOf('{"stdout":')));
		expect(diagnostics).toEqual({
			stdout: { text: "x".repeat(2048), truncated: false },
			stderr: { text: "", truncated: false },
		});
	});

	it("confirms cleanup through the process identity when the polling deadline expires", async () => {
		const clock = vi.spyOn(Date, "now").mockReturnValue(120_000);
		clock.mockReturnValueOnce(0);
		const cleanup = vi.fn(async (body: string) =>
			String(
				runInNewContext(`(function(){${body}})()`, {
					u: {
						execute: (_vm: unknown, options: { readonly withArguments: readonly string[] }) => {
							expect(options.withArguments).toEqual(["/PID", "42", "/T", "/F"]);
							return { id: () => 99 };
						},
						getResult: (id: number) => {
							expect(id).toBe(99);
							return { exited: true, exitCode: 0 };
						},
					},
				}),
			),
		);
		try {
			await expect(
				windowsGuestDisplay(async () => "42", "const v = {guestProcesses:{byId:id=>id}};", undefined, cleanup),
			).rejects.toThrow("Timed out reading");
			expect(cleanup).toHaveBeenCalledTimes(2);
		} finally {
			clock.mockRestore();
		}
	});

	it("rejects a nonnumeric process identifier before polling", async () => {
		const script = vi.fn(async () => "not-a-pid");
		await expect(windowsGuestDisplay(script, "const v = {};")).rejects.toThrow("process identifier");
		expect(script).toHaveBeenCalledTimes(1);
	});

	it("requests termination through the cleanup channel when polling is interrupted", async () => {
		let call = 0;
		let cleanupCalls = 0;
		const cleanup = vi.fn(async () => (++cleanupCalls === 1 ? "99" : JSON.stringify({ exited: true, exitCode: 0 })));
		await expect(
			windowsGuestDisplay(
				async () => {
					if (++call === 1) return "42";
					throw new Error("cancelled");
				},
				"const v = {};",
				{ x: 10, y: 20 },
				cleanup,
			),
		).rejects.toThrow("cancelled");
		expect(cleanup).toHaveBeenCalledWith(expect.stringContaining('"/PID","42","/T","/F"'));
		expect(cleanup).toHaveBeenCalledWith(expect.stringContaining("guestProcesses.byId(99)"));
	});

	it("waits for confirmed termination before rejecting interrupted input", async () => {
		let release: (value: string) => void = () => undefined;
		let observed: () => void = () => undefined;
		const cleanupReached = new Promise<void>((resolve) => {
			observed = resolve;
		});
		const cleanupResult = new Promise<string>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		let cleaning = 0;
		let rejected = false;
		const result = windowsGuestDisplay(
			async () => {
				if (++calls === 1) return "42";
				throw new Error("stopped");
			},
			"const v = {};",
			{ x: 1, y: 2 },
			async () => {
				if (++cleaning === 1) return "99";
				observed();
				return cleanupResult;
			},
		).catch((error: unknown) => {
			rejected = true;
			throw error;
		});
		const assertion = whenSettled(result, (settled) => expect(settled).rejects.toThrow("stopped"));
		await cleanupReached;
		expect(rejected).toBe(false);
		release(JSON.stringify({ exited: true, exitCode: 0 }));
		await assertion;
		expect(rejected).toBe(true);
	});
});
