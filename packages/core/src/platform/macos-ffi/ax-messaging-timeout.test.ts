import { describe, expect, it, vi } from "vitest";

const koffiMock = vi.hoisted(() => {
	const applicationElement = { type: "ax-app" };

	const coreFoundationFunctions = {
		CFGetTypeID: vi.fn(() => 1),
		CFRetain: vi.fn((reference: object) => reference),
		CFStringCreateWithCString: vi.fn(() => ({ type: "cf-string" })),
		CFStringGetLength: vi.fn(),
		CFStringGetMaximumSizeForEncoding: vi.fn(),
		CFStringGetCString: vi.fn(),
		CFArrayCreate: vi.fn(() => ({ type: "cf-array", values: [] })),
		CFArrayGetCount: vi.fn(() => 0),
		CFArrayGetValueAtIndex: vi.fn(() => null),
		CFStringGetTypeID: vi.fn(() => 1),
		CFNumberGetTypeID: vi.fn(() => 2),
		CFNumberGetValue: vi.fn(),
		CFBooleanGetTypeID: vi.fn(() => 3),
		CFBooleanGetValue: vi.fn(),
		CFArrayGetTypeID: vi.fn(() => 6),
		CFNullGetTypeID: vi.fn(() => 7),
		CFRelease: vi.fn(),
	};

	const accessibilityFunctions = {
		AXIsProcessTrusted: vi.fn(() => true),
		AXUIElementCreateApplication: vi.fn(() => applicationElement),
		AXUIElementCreateSystemWide: vi.fn(() => ({ type: "ax-systemwide" })),
		AXUIElementSetMessagingTimeout: vi.fn(() => 0),
		AXUIElementCopyElementAtPosition: vi.fn(() => 0),
		AXUIElementGetPid: vi.fn(() => 0),
		AXUIElementGetTypeID: vi.fn(() => 4),
		AXValueGetTypeID: vi.fn(() => 5),
		AXValueGetType: vi.fn(),
		AXValueGetValue: vi.fn(),
		AXUIElementPerformAction: vi.fn(() => 0),
		AXUIElementSetAttributeValue: vi.fn(() => 0),
		AXUIElementCopyAttributeValue: vi.fn(),
		AXUIElementCopyActionNames: vi.fn(),
		AXUIElementCopyMultipleAttributeValues: vi.fn(),
		_AXUIElementGetWindow: vi.fn(() => -25205),
	};

	function libraryFor(path: string) {
		if (path === "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices") {
			return accessibilityFunctions;
		}
		if (path === "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation") {
			return coreFoundationFunctions;
		}
		throw new Error(`Unexpected library: ${path}`);
	}

	return {
		applicationElement,
		accessibilityFunctions,
		module: {
			load: vi.fn((path: string) => ({
				func: vi.fn((name: string | number) => {
					const nativeFunctions = libraryFor(path);
					const nativeFunction = nativeFunctions[nativeFunctionName(name) as keyof typeof nativeFunctions];
					if (nativeFunction === undefined) {
						throw new Error(`Unexpected native function: ${String(name)}`);
					}
					return nativeFunction;
				}),
			})),
			opaque: vi.fn(() => ({ type: "opaque" })),
			pointer: vi.fn((name: unknown) => ({ type: "pointer", name })),
			out: vi.fn((type: unknown) => ({ type: "out", inner: type })),
		},
	};
});

vi.mock("koffi", () => koffiMock.module);

function nativeFunctionName(name: string | number): string {
	const source = String(name);
	const prototypeMatch = source.match(/\s([A-Za-z_][A-Za-z0-9_]*)\(/);
	return prototypeMatch?.[1] ?? source;
}

describe("resolveAxMessagingTimeoutSeconds", () => {
	it("#given no environment override #when the timeout is resolved #then it is the finite default", async () => {
		const { DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS, resolveAxMessagingTimeoutSeconds } = await import(
			"./accessibility.js"
		);

		expect(resolveAxMessagingTimeoutSeconds({})).toBe(DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS);
		expect(DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS).toBeGreaterThan(0);
	});

	it("#given a numeric override #when the timeout is resolved #then the override is used", async () => {
		const { resolveAxMessagingTimeoutSeconds } = await import("./accessibility.js");

		expect(resolveAxMessagingTimeoutSeconds({ APPLE_CUA_AX_TIMEOUT_SECONDS: "5" })).toBe(5);
		expect(resolveAxMessagingTimeoutSeconds({ APPLE_CUA_AX_TIMEOUT_SECONDS: "0.25" })).toBe(0.25);
	});

	it("#given a nonsense override #when the timeout is resolved #then the default wins instead of an unbounded wait", async () => {
		const { DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS, resolveAxMessagingTimeoutSeconds } = await import(
			"./accessibility.js"
		);

		expect(resolveAxMessagingTimeoutSeconds({ APPLE_CUA_AX_TIMEOUT_SECONDS: "soon" })).toBe(
			DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS,
		);
		expect(resolveAxMessagingTimeoutSeconds({ APPLE_CUA_AX_TIMEOUT_SECONDS: "-1" })).toBe(
			DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS,
		);
	});
});

describe("createApplicationElement", () => {
	it("#given an app element #when it is created #then a finite messaging timeout is set on it before any read", async () => {
		const { createApplicationElement, DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS } = await import("./accessibility.js");

		koffiMock.accessibilityFunctions.AXUIElementSetMessagingTimeout.mockClear();
		const element = createApplicationElement(2468);

		expect(element).toBe(koffiMock.applicationElement);
		expect(koffiMock.accessibilityFunctions.AXUIElementSetMessagingTimeout).toHaveBeenCalledWith(
			koffiMock.applicationElement,
			DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS,
		);
	});

	it("#given the timeout is switched off #when an app element is created #then nothing is set", async () => {
		const { createApplicationElement } = await import("./accessibility.js");

		const previous = process.env["APPLE_CUA_AX_TIMEOUT_SECONDS"];
		process.env["APPLE_CUA_AX_TIMEOUT_SECONDS"] = "0";
		try {
			koffiMock.accessibilityFunctions.AXUIElementSetMessagingTimeout.mockClear();
			createApplicationElement(2468);
			expect(koffiMock.accessibilityFunctions.AXUIElementSetMessagingTimeout).not.toHaveBeenCalled();
		} finally {
			if (previous === undefined) {
				process.env["APPLE_CUA_AX_TIMEOUT_SECONDS"] = "";
			} else {
				process.env["APPLE_CUA_AX_TIMEOUT_SECONDS"] = previous;
			}
		}
	});
});
