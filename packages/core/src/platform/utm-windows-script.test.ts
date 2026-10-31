import { describe, expect, it } from "bun:test";
import { gunzipSync } from "node:zlib";
import { windowsGuestDisplay } from "./utm-guest.js";
import { windowsDisplayDiagnostic, windowsDisplayNativeSource, windowsDisplayScript } from "./utm-windows-script.js";

function envelope(body: Uint8Array, exit = 1): string {
	const header = Buffer.alloc(4);
	header.writeUInt32LE(body.length);
	return `CUA1:${Buffer.concat([header, body]).toString("base64")}:${exit}\r\n`;
}

function contextBody(error: string, fields: readonly string[], truncated = 0): Buffer {
	const primary = Buffer.from(error, "utf8");
	return Buffer.concat([
		Buffer.from([2, 1, truncated]),
		Buffer.from(primary.length.toString().padStart(3, "0")),
		primary,
		Buffer.from(`\0${fields.join("\0")}`, "utf8"),
	]);
}

describe("#given bounded failure context #when decoded #then policy and named facts remain distinct", () => {
	const fields = [
		"0S-1-5-21-10",
		"0C:\\Users\\A\\Temp",
		"0C:\\Users\\B\\Temp",
		"0C:\\Users\\C",
		"0C:\\Users\\D\\AppData\\Local",
		"0C:\\Users\\E\\Temp\\",
		"0S-1-5-21-20",
	];
	const context = {
		childSid: { status: "value", value: "S-1-5-21-10" },
		TEMP: { status: "value", value: "C:\\Users\\A\\Temp" },
		TMP: { status: "value", value: "C:\\Users\\B\\Temp" },
		USERPROFILE: { status: "value", value: "C:\\Users\\C" },
		localApplicationData: { status: "value", value: "C:\\Users\\D\\AppData\\Local" },
		tempPath: { status: "value", value: "C:\\Users\\E\\Temp\\" },
		selectedSid: { status: "value", value: "S-1-5-21-20" },
	};

	it("consumes the parent policy version without losing the original compiler failure", () => {
		const error = "System.Exception: Source file 'C:\\WINDOWS\\TEMP\\lorvtfmj.0.cs' could not be found";
		expect(windowsDisplayDiagnostic(envelope(contextBody(error, fields)))).toBe(
			`stage=child-add-type; childExit=1; envPolicy=console-token-block-v1; errorTruncated=false; error=${error}; context=${JSON.stringify(context)}`,
		);
	});

	it("counts primary error bytes rather than characters and preserves embedded NUL", () => {
		const error = "\ufeff오류\0source missing";
		expect(windowsDisplayDiagnostic(envelope(contextBody(error, fields)))).toBe(
			`stage=child-add-type; childExit=1; envPolicy=console-token-block-v1; errorTruncated=false; error=${error}; context=${JSON.stringify(context)}`,
		);
	});

	it("keeps lookup failure, unset values and per-field truncation separate from error truncation", () => {
		const output = windowsDisplayDiagnostic(
			envelope(contextBody("original failure", ["2", "3", `1${"é".repeat(32)}`, "0", "2", "3", "0S-1"])),
		);
		expect(output).toContain("errorTruncated=false; error=original failure;");
		const decoded: unknown = JSON.parse(output.slice(output.indexOf("; context=") + 10));
		expect(decoded).toEqual({
			childSid: { status: "unavailable", value: "" },
			TEMP: { status: "unset", value: "" },
			TMP: { status: "truncated", value: "é".repeat(32) },
			USERPROFILE: { status: "value", value: "" },
			localApplicationData: { status: "unavailable", value: "" },
			tempPath: { status: "unset", value: "" },
			selectedSid: { status: "value", value: "S-1" },
		});
	});

	it("retains a full 512-byte primary prefix when every field reaches its own byte limit", () => {
		const error = "e".repeat(512);
		const body = contextBody(
			error,
			Array.from({ length: 7 }, () => `1${"é".repeat(32)}`),
			1,
		);
		expect(body.length).toBe(980);
		const output = windowsDisplayDiagnostic(envelope(body));
		expect(output).toContain(`errorTruncated=true; error=${error}; context=`);
		expect(output).toContain('"selectedSid":{"status":"truncated","value":');
	});

	it.each([
		["extra field", contextBody("primary", [...fields, "0extra"])],
		["missing field", contextBody("primary", fields.slice(1))],
		["empty status", contextBody("primary", ["", ...fields.slice(1)])],
		["unknown status", contextBody("primary", ["4bad", ...fields.slice(1)])],
		["unavailable with data", contextBody("primary", ["2secret", ...fields.slice(1)])],
		["unset with data", contextBody("primary", ["3secret", ...fields.slice(1)])],
		["oversized field", contextBody("primary", [`0${"é".repeat(33)}`, ...fields.slice(1)])],
		["oversized primary", contextBody("e".repeat(513), fields)],
		[
			"wrong length digits",
			Buffer.concat([Buffer.from([2, 1, 0, 0xb0, 0xb0, 0xb0]), Buffer.from(`\0${fields.join("\0")}`)]),
		],
		["incomplete primary", Buffer.from([2, 1, 0, 0x35, 0x31, 0x32])],
		[
			"invalid primary UTF-8",
			Buffer.concat([
				Buffer.from([2, 1, 0]),
				Buffer.from("001"),
				Buffer.from([0xff]),
				Buffer.from(`\0${fields.join("\0")}`),
			]),
		],
		["invalid field UTF-8", Buffer.concat([contextBody("primary", fields), Buffer.from([0xff])])],
		["missing field delimiter", Buffer.from([2, 1, 0, 0x30, 0x30, 0x30])],
	] as const)("rejects %s", (_name, body) => {
		expect(windowsDisplayDiagnostic(envelope(body))).toBe(
			"stage=parent-frame; error=invalid child diagnostic envelope",
		);
	});

	it("keeps failed context untrusted and escaped through the real outer diagnostic boundary", async () => {
		const primary = 'source missing "\n\u202e';
		const raw = envelope(contextBody(primary, ["2", "3", "0C:\\Temp\n\u001b", "0", "2", "3", "0S-1"]));
		let calls = 0;
		const failure = await windowsGuestDisplay(async () => {
			if (++calls === 1) return "42";
			return JSON.stringify({ exited: true, exitCode: 1, outputText: raw, errorText: "" });
		}, "const v = {};").catch((error: unknown) => error);
		if (!(failure instanceof Error)) throw new Error("Expected a failed observation");
		expect(calls).toBe(2);
		expect(failure.message).toContain("envPolicy=console-token-block-v1");
		expect(failure.message).toContain("source missing");
		expect(failure.message).not.toContain("\n");
		expect(failure.message).not.toContain("\u001b");
		expect(failure.message).not.toContain("\u202e");
	});
});

describe("#given a child diagnostic frame #when decoded #then only bounded valid failure data is exposed", () => {
	it.each([
		[1, "child-add-type"],
		[2, "child-metrics"],
		[3, "child-cursor-bounds"],
		[4, "child-cursor"],
	] as const)("decodes stage %i and preserves its error text", (stage, name) => {
		const frame = envelope(Buffer.concat([Buffer.from([1, stage, 0]), Buffer.from("Compiler error CS0246")]));
		expect(windowsDisplayDiagnostic(frame)).toBe(
			`stage=${name}; childExit=1; errorTruncated=false; error=Compiler error CS0246`,
		);
	});

	it("preserves UTF-8 text, including a leading BOM, as untrusted data", () => {
		const text = '\ufeff오류 "\n\u001b[31m\u202e';
		const frame = envelope(Buffer.concat([Buffer.from([1, 2, 0]), Buffer.from(text)]), 0);
		expect(windowsDisplayDiagnostic(frame)).toBe(
			`stage=child-metrics; childExit=0; errorTruncated=false; error=${text}`,
		);
	});

	it("accepts the exact byte limit and carries the child's truncation flag", () => {
		const frame = envelope(Buffer.concat([Buffer.from([1, 1, 1]), Buffer.from("é".repeat(512))]));
		expect(windowsDisplayDiagnostic(frame)).toBe(
			`stage=child-add-type; childExit=1; errorTruncated=true; error=${"é".repeat(512)}`,
		);
	});

	it("accepts an empty error without inventing diagnostic text", () => {
		expect(windowsDisplayDiagnostic(envelope(Buffer.from([1, 4, 0]), 3))).toBe(
			"stage=child-cursor; childExit=3; errorTruncated=false; error=",
		);
	});

	it.each([
		["empty body", envelope(Buffer.alloc(0))],
		["short body", envelope(Buffer.from([1, 1]))],
		["wrong version", envelope(Buffer.from([3, 1, 0]))],
		["success stage", envelope(Buffer.from([1, 0, 0]))],
		["unknown stage", envelope(Buffer.from([1, 5, 0]))],
		["invalid flag", envelope(Buffer.from([1, 1, 2]))],
		["oversized body", envelope(Buffer.concat([Buffer.from([1, 1, 0]), Buffer.alloc(1025)]))],
		["overlong UTF-8", envelope(Buffer.from([1, 1, 0, 0xc0, 0xaf]))],
		["partial UTF-8", envelope(Buffer.from([1, 1, 0, 0xe2, 0x82]))],
		["UTF-8 surrogate", envelope(Buffer.from([1, 1, 0, 0xed, 0xa0, 0x80]))],
		["packed success exit", envelope(Buffer.from([1, 1, 0]), 65536)],
		["negative exit", envelope(Buffer.from([1, 1, 0]), -1)],
		["extra record", `${envelope(Buffer.from([1, 1, 0]))}extra`],
		["invalid base64", "CUA1:@@@:1"],
		["oversized envelope", `CUA1:${"A".repeat(1400)}:1`],
	] as const)("rejects %s", (_name, frame) => {
		expect(windowsDisplayDiagnostic(frame)).toBe("stage=parent-frame; error=invalid child diagnostic envelope");
	});

	it("rejects a valid prefix with an incomplete declared frame", () => {
		const frame = Buffer.from([4, 0, 0, 0, 1, 1, 0]);
		expect(windowsDisplayDiagnostic(`CUA1:${frame.toString("base64")}:1`)).toBe(
			"stage=parent-frame; error=invalid child diagnostic envelope",
		);
	});

	it("rejects trailing bytes outside the declared frame", () => {
		const frame = Buffer.from([3, 0, 0, 0, 1, 1, 0, 0]);
		expect(windowsDisplayDiagnostic(`CUA1:${frame.toString("base64")}:1`)).toBe(
			"stage=parent-frame; error=invalid child diagnostic envelope",
		);
	});

	it("rejects noncanonical base64 rather than accepting a partial decoding", () => {
		expect(windowsDisplayDiagnostic("CUA1:AwAAAAEBAA:1")).toBe(
			"stage=parent-frame; error=invalid child diagnostic envelope",
		);
	});

	it.each(["", "1024x768\r\n", "stage=parent-token; error=Access denied"])(
		"leaves non-envelope output %j to the existing formatter",
		(output) => {
			expect(windowsDisplayDiagnostic(output)).toBe(output);
		},
	);

	it("preserves the child frame alongside a separate unconfirmed-tree diagnostic", async () => {
		const childError = 'compiler failure "\n\u202e';
		const cleanupError = 'stage=parent-tree-cleanup-unconfirmed; error="missing process notification"';
		const outputText = envelope(Buffer.concat([Buffer.from([1, 1, 0]), Buffer.from(childError)]));
		let calls = 0;
		const error = await windowsGuestDisplay(async () => {
			if (++calls === 1) return "42";
			return JSON.stringify({ exited: true, exitCode: 1, outputText, errorText: cleanupError });
		}, "const v = {};").catch((error: unknown) => error);
		if (!(error instanceof Error)) throw new Error("Expected a failed observation");
		const diagnostics: unknown = JSON.parse(error.message.slice(error.message.indexOf('{"stdout":')));
		expect(diagnostics).toEqual({
			stdout: {
				text: `stage=child-add-type; childExit=1; errorTruncated=false; error=${childError}`,
				truncated: false,
			},
			stderr: { text: cleanupError, truncated: false },
		});
		expect(error.message).not.toContain("\n");
		expect(error.message).toContain("\\u202e");
	});

	it.each(["parent-environment-create", "parent-environment-destroy"])(
		"reports %s without retrying or accepting dimensions from a failed helper",
		async (stage) => {
			const errorText = `stage=${stage}; error=Win32Exception: "\n\u001b[31m\u202e${"x".repeat(2100)}`;
			let calls = 0;
			const cleanup = async (): Promise<string> => {
				throw new Error("An exited helper must not be killed");
			};
			const error = await windowsGuestDisplay(
				async () => {
					if (++calls === 1) return "42";
					return JSON.stringify({ exited: true, exitCode: 1, outputText: "1920x1080", errorText });
				},
				"const v = {};",
				undefined,
				cleanup,
			).catch((error: unknown) => error);
			if (!(error instanceof Error)) throw new Error("Expected a failed observation");
			const diagnostics: unknown = JSON.parse(error.message.slice(error.message.indexOf('{"stdout":')));
			expect(diagnostics).toEqual({
				stdout: { text: "1920x1080", truncated: false },
				stderr: { text: errorText.slice(0, 2048), truncated: true },
			});
			expect(calls).toBe(2);
			expect(error.message).not.toContain("\n");
			expect(error.message).not.toContain("\u001b");
			expect(error.message).toContain("\\u202e");
		},
	);
});

describe("#given the generated helper #when encoded for Windows #then the real command fits the launch boundary", () => {
	it("ships the exact native TypeDefinition through its compressed command payload", () => {
		const script = windowsDisplayScript();
		const encoded = /^\$native=\[Convert\]::FromBase64String\('([A-Za-z0-9+/=]+)'\);$/mu.exec(script)?.[1];
		if (encoded === undefined) throw new Error("Missing native source payload");
		const shipped = gunzipSync(Buffer.from(encoded, "base64"));
		expect(shipped.equals(Buffer.from(windowsDisplayNativeSource, "utf8"))).toBe(true);
	});

	it.each([undefined, { x: 32766, y: 32766 }, { x: Number.MAX_VALUE, y: Number.MAX_VALUE }])(
		"leaves command-line room for PowerShell and its switches at %j",
		(position) => {
			const encoded = Buffer.from(windowsDisplayScript(position), "utf16le").toString("base64");
			// Windows CreateProcess allows 32767 UTF-16 units, including the executable and switches.
			expect(encoded.length).toBeLessThan(30_000);
		},
	);
});
