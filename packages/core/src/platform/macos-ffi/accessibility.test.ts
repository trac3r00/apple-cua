import { describe, expect, it, vi } from "vitest";

const koffiMock = vi.hoisted(() => {
	const actionReference = { type: "cf-string", value: "AXPress" };
	const attributeReference = { type: "cf-string", value: "AXValue" };
	const applicationElement = { type: "ax-app" };
	const copiedValue = { type: "copied-value" };

	const coreFoundationFunctions = {
		CFStringCreateWithCString: vi.fn((_allocator: null, value: string) =>
			value === "AXPress" ? actionReference : attributeReference,
		),
		CFStringGetLength: vi.fn(),
		CFStringGetMaximumSizeForEncoding: vi.fn(),
		CFStringGetCString: vi.fn(),
		CFArrayCreate: vi.fn(),
		CFRelease: vi.fn(),
	};

	const accessibilityFunctions = {
		AXUIElementCreateApplication: vi.fn(() => applicationElement),
		AXUIElementPerformAction: vi.fn(() => 0),
		AXUIElementSetAttributeValue: vi.fn(() => 0),
		AXUIElementCopyAttributeValue: vi.fn((_element: object, _attribute: object, outValue: Array<object | null>) => {
			outValue[0] = copiedValue;
			return 0;
		}),
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
		actionReference,
		applicationElement,
		attributeReference,
		copiedValue,
		accessibilityFunctions,
		coreFoundationFunctions,
		module: {
			load: vi.fn((path: string) => ({
				func: vi.fn((name: string | number) => {
					const nativeFunctions = libraryFor(path);
					const nativeFunction = nativeFunctions[String(name) as keyof typeof nativeFunctions];
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

describe("#given Accessibility AXUIElement koffi bindings", () => {
	describe("#when creating an app element and performing AX operations", () => {
		it("#then calls AX functions with CFString-backed attributes and releases temporary CFRefs", async () => {
			const {
				K_AX_PRESS_ACTION,
				K_AX_VALUE_ATTRIBUTE,
				copyAttributeValue,
				createApplicationElement,
				performAction,
			} = await import("./accessibility.js");

			const element = createApplicationElement(2468);
			performAction(element, K_AX_PRESS_ACTION);
			const value = copyAttributeValue(element, K_AX_VALUE_ATTRIBUTE);

			expect(element).toBe(koffiMock.applicationElement);
			expect(koffiMock.accessibilityFunctions.AXUIElementCreateApplication).toHaveBeenCalledWith(2468);
			expect(koffiMock.accessibilityFunctions.AXUIElementPerformAction).toHaveBeenCalledWith(
				koffiMock.applicationElement,
				koffiMock.actionReference,
			);
			expect(koffiMock.accessibilityFunctions.AXUIElementCopyAttributeValue).toHaveBeenCalledWith(
				koffiMock.applicationElement,
				koffiMock.attributeReference,
				[koffiMock.copiedValue],
			);
			expect(value).toBe(koffiMock.copiedValue);
			expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledWith(koffiMock.actionReference);
			expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledWith(koffiMock.attributeReference);
		});
	});
});
