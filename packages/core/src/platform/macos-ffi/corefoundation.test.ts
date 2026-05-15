import { describe, expect, it, vi } from "vitest";

const koffiMock = vi.hoisted(() => {
	const nativeFunctions = {
		CFGetTypeID: vi.fn(() => 1),
		CFRetain: vi.fn((reference: object) => reference),
		CFStringCreateWithCString: vi.fn((_allocator: null, value: string) => ({ type: "cf-string", value })),
		CFStringGetLength: vi.fn(() => 5),
		CFStringGetMaximumSizeForEncoding: vi.fn(() => 16),
		CFStringGetCString: vi.fn((_reference: object, buffer: Buffer) => {
			buffer.write("hello\0", 0, "utf8");
			return true;
		}),
		CFArrayCreate: vi.fn((_allocator: null, values: readonly object[] | null) => ({ type: "cf-array", values })),
		CFArrayGetCount: vi.fn(() => 1),
		CFArrayGetValueAtIndex: vi.fn((_reference: object, _index: number) => ({ type: "cf-array-value" })),
		CFStringGetTypeID: vi.fn(() => 1),
		CFNumberGetTypeID: vi.fn(() => 2),
		CFNumberGetValue: vi.fn((_reference: object, _type: number, buffer: Buffer) => {
			buffer.writeDoubleLE(7, 0);
			return true;
		}),
		CFBooleanGetTypeID: vi.fn(() => 3),
		CFBooleanGetValue: vi.fn(() => true),
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
			const {
				cfArrayLength,
				cfArrayValueAt,
				fromCFBoolean,
				fromCFNumber,
				fromCFString,
				toCFString,
				withCFArray,
				withCFString,
			} = await import("./corefoundation.js");

			const stringReference = toCFString("AXPress");
			const decoded = fromCFString(stringReference);
			const callbackResult = withCFString("AXValue", (reference) => ({ reference }));
			const arrayResult = withCFArray([stringReference], (reference) => ({ reference }));
			const length = cfArrayLength(arrayResult.reference);
			const arrayValue = cfArrayValueAt(arrayResult.reference, 0);
			const number = fromCFNumber({ type: "cf-number" });
			const boolean = fromCFBoolean({ type: "cf-boolean" });

			expect(koffiMock.nativeFunctions.CFStringCreateWithCString).toHaveBeenCalledWith(null, "AXPress", 0x08000100);
			expect(decoded).toBe("hello");
			expect(length).toBe(1);
			expect(arrayValue).toEqual({ type: "cf-array-value" });
			expect(number).toBe(7);
			expect(boolean).toBe(true);
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
