import { describe, expect, it, vi } from "vitest";

const koffiMock = vi.hoisted(() => {
	const nativeFunctions = {
		CFStringCreateWithCString: vi.fn((_allocator: null, value: string) => ({ type: "cf-string", value })),
		CFStringGetLength: vi.fn(() => 5),
		CFStringGetMaximumSizeForEncoding: vi.fn(() => 16),
		CFStringGetCString: vi.fn((_reference: object, buffer: Buffer) => {
			buffer.write("hello\0", 0, "utf8");
			return true;
		}),
		CFArrayCreate: vi.fn((_allocator: null, values: readonly object[] | null) => ({ type: "cf-array", values })),
		CFRelease: vi.fn(),
	};
	const coreFoundationLibrary = {
		func: vi.fn((name: string | number) => {
			const nativeFunction = nativeFunctions[String(name) as keyof typeof nativeFunctions];
			if (nativeFunction === undefined) {
				throw new Error(`Unexpected native function: ${String(name)}`);
			}
			return nativeFunction;
		}),
	};

	return {
		coreFoundationLibrary,
		nativeFunctions,
		module: {
			load: vi.fn(() => coreFoundationLibrary),
			opaque: vi.fn(() => ({ type: "opaque" })),
			pointer: vi.fn((name: unknown) => ({ type: "pointer", name })),
		},
	};
});

vi.mock("koffi", () => koffiMock.module);

describe("#given CoreFoundation koffi bindings", () => {
	describe("#when converting JavaScript strings and arrays to CFRefs", () => {
		it("#then creates and releases owned CoreFoundation references", async () => {
			const { fromCFString, toCFString, withCFArray, withCFString } = await import("./corefoundation.js");

			const stringReference = toCFString("AXPress");
			const decoded = fromCFString(stringReference);
			const callbackResult = withCFString("AXValue", (reference) => ({ reference }));
			const arrayResult = withCFArray([stringReference], (reference) => ({ reference }));

			expect(koffiMock.nativeFunctions.CFStringCreateWithCString).toHaveBeenCalledWith(null, "AXPress", 0x08000100);
			expect(decoded).toBe("hello");
			expect(callbackResult.reference).toEqual({ type: "cf-string", value: "AXValue" });
			expect(arrayResult.reference).toEqual({ type: "cf-array", values: [stringReference] });
			expect(koffiMock.nativeFunctions.CFRelease).toHaveBeenCalledWith(callbackResult.reference);
			expect(koffiMock.nativeFunctions.CFRelease).toHaveBeenCalledWith(arrayResult.reference);
		});
	});

	describe("#when binding CFRelease", () => {
		it("#then accepts any CoreFoundation-derived pointer", async () => {
			await import("./corefoundation.js");

			expect(koffiMock.coreFoundationLibrary.func).toHaveBeenCalledWith("CFRelease", "void", ["void *"]);
		});
	});
});
