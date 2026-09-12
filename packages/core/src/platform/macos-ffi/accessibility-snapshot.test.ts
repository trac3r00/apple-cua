import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const koffiMock = vi.hoisted(() => {
	type Reference = {
		readonly type: string;
		readonly value?: string;
		readonly location?: number;
		readonly length?: number;
		children?: Reference[];
		readonly attributes?: Record<string, string>;
		readonly actions?: readonly string[];
	};

	const observableState: {
		fieldValue: string;
		pressCount: number;
		selection: { location: number; length: number } | null;
	} = {
		fieldValue: "initial",
		pressCount: 0,
		selection: null,
	};

	const targetButton: Reference = {
		type: "ax",
		attributes: { AXRole: "AXButton", AXTitle: "Target Button" },
		actions: ["AXPress"],
		children: [],
	};
	const textField: Reference = {
		type: "ax",
		attributes: { AXRole: "AXTextField", AXDescription: "Editable", AXValue: "initial" },
		actions: ["AXConfirm"],
		children: [],
	};
	const windowElement: Reference = {
		type: "ax",
		attributes: { AXRole: "AXWindow", AXTitle: "Fixture" },
		children: [textField, targetButton],
	};
	const applicationElement: Reference = {
		type: "ax",
		attributes: { AXRole: "AXApplication", AXTitle: "Fixture" },
		children: [windowElement],
	};
	const insertedPrefix: Reference = {
		type: "ax",
		attributes: { AXRole: "AXButton", AXTitle: "Inserted Prefix" },
		actions: ["AXPress"],
		children: [],
	};

	const coreFoundationFunctions = {
		CFGetTypeID: vi.fn((reference: Reference) => (reference.type === "ax" ? 4 : reference.type === "string" ? 1 : 6)),
		CFRetain: vi.fn((reference: Reference) => reference),
		CFStringCreateWithCString: vi.fn((_allocator: null, value: string) => ({ type: "string", value })),
		CFStringGetLength: vi.fn((reference: Reference) => reference.value?.length ?? 0),
		CFStringGetMaximumSizeForEncoding: vi.fn((length: number) => length * 4),
		CFStringGetCString: vi.fn((reference: Reference, buffer: Buffer) => {
			buffer.write(reference.value ?? "", "utf8");
			return true;
		}),
		CFArrayCreate: vi.fn(),
		CFArrayGetCount: vi.fn((reference: Reference) => reference.children?.length ?? 0),
		CFArrayGetValueAtIndex: vi.fn((reference: Reference, index: number) => reference.children?.[index] ?? null),
		CFStringGetTypeID: vi.fn(() => 1),
		CFNumberGetTypeID: vi.fn(() => 2),
		CFNumberGetValue: vi.fn(),
		CFBooleanGetTypeID: vi.fn(() => 3),
		CFBooleanGetValue: vi.fn(),
		CFRelease: vi.fn(),
	};

	const accessibilityFunctions = {
		AXIsProcessTrusted: vi.fn(() => true),
		AXUIElementCreateApplication: vi.fn(() => applicationElement),
		AXUIElementCreateSystemWide: vi.fn(),
		AXUIElementCopyElementAtPosition: vi.fn(),
		AXUIElementGetPid: vi.fn(),
		AXUIElementGetTypeID: vi.fn(() => 4),
		AXValueGetTypeID: vi.fn(() => 5),
		AXValueGetType: vi.fn(),
		AXValueGetValue: vi.fn(),
		AXValueCreate: vi.fn((_type: number, buffer: Buffer) => ({
			type: "range",
			location: Number(buffer.readBigInt64LE(0)),
			length: Number(buffer.readBigInt64LE(8)),
		})),
		AXUIElementPerformAction: vi.fn((element: Reference, action: Reference) => {
			if (action.value === undefined || !element.actions?.includes(action.value)) return -25206;
			if (element === targetButton && action.value === "AXPress") observableState.pressCount += 1;
			return 0;
		}),
		AXUIElementSetAttributeValue: vi.fn((element: Reference, attribute: Reference, value: Reference) => {
			if (element !== textField) return -25205;
			if (attribute.value === "AXValue" && value.value !== undefined) {
				observableState.fieldValue = value.value;
				if (textField.attributes !== undefined) textField.attributes.AXValue = value.value;
				return 0;
			}
			if (attribute.value === "AXSelectedTextRange" && value.location !== undefined && value.length !== undefined) {
				observableState.selection = { location: value.location, length: value.length };
				return 0;
			}
			return -25205;
		}),
		AXUIElementCopyAttributeValue: vi.fn(
			(element: Reference, attribute: Reference, outValue: Array<Reference | null>) => {
				if (attribute.value === "AXChildren") {
					outValue[0] = { type: "array", children: element.children ?? [] };
					return 0;
				}
				const value = attribute.value === undefined ? undefined : element.attributes?.[attribute.value];
				if (value === undefined) return -25205;
				outValue[0] = { type: "string", value };
				return 0;
			},
		),
		AXUIElementCopyActionNames: vi.fn((element: Reference, outActions: Array<Reference | null>) => {
			outActions[0] = {
				type: "array",
				children: element.actions?.map((value) => ({ type: "string", value })) ?? [],
			};
			return 0;
		}),
	};

	function libraryFor(path: string) {
		if (path.includes("ApplicationServices.framework")) return accessibilityFunctions;
		if (path.includes("CoreFoundation.framework")) return coreFoundationFunctions;
		throw new Error(`Unexpected library: ${path}`);
	}

	return {
		accessibilityFunctions,
		applicationElement,
		coreFoundationFunctions,
		insertedPrefix,
		observableState,
		targetButton,
		textField,
		windowElement,
		module: {
			load: vi.fn((path: string) => ({
				func: vi.fn((name: string | number) => {
					const source = String(name);
					const prototypeMatch = source.match(/\s([A-Za-z_][A-Za-z0-9_]*)\(/);
					const functionName = prototypeMatch?.[1] ?? source;
					const library = libraryFor(path);
					const nativeFunction = library[functionName as keyof typeof library];
					if (nativeFunction === undefined) throw new Error(`Unexpected native function: ${functionName}`);
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

beforeEach(() => {
	koffiMock.windowElement.children = [koffiMock.textField, koffiMock.targetButton];
	koffiMock.observableState.fieldValue = "initial";
	koffiMock.observableState.pressCount = 0;
	koffiMock.observableState.selection = null;
	if (koffiMock.textField.attributes !== undefined) koffiMock.textField.attributes.AXValue = "initial";
	koffiMock.accessibilityFunctions.AXIsProcessTrusted.mockReturnValue(true);
	koffiMock.accessibilityFunctions.AXUIElementPerformAction.mockClear();
	koffiMock.coreFoundationFunctions.CFRelease.mockClear();
	koffiMock.coreFoundationFunctions.CFRetain.mockClear();
});

afterEach(async () => {
	const { releaseAccessibilitySnapshot } = await import("./accessibility.js");
	releaseAccessibilitySnapshot(process.pid);
});

describe("#given an AX element index from an accessibility snapshot", () => {
	it("#when the live hierarchy shifts #then the action still targets the snapshotted element", async () => {
		const { extractAccessibilityTree, performActionByIndex } = await import("./accessibility.js");
		const snapshot = extractAccessibilityTree(process.pid);
		const button = snapshot.elements.find((element) => element.label === "Target Button");
		expect(button).toBeDefined();

		koffiMock.windowElement.children = [koffiMock.insertedPrefix, koffiMock.textField, koffiMock.targetButton];
		performActionByIndex(process.pid, button?.id ?? -1, "AXPress");

		expect(koffiMock.observableState.pressCount).toBe(1);
	});

	it("#when a live node appears past the snapshot #then an unobserved id is rejected without acting", async () => {
		const { extractAccessibilityTree, performActionByIndex } = await import("./accessibility.js");
		const snapshot = extractAccessibilityTree(process.pid);
		expect(snapshot.elements).toHaveLength(4);

		koffiMock.windowElement.children = [koffiMock.insertedPrefix, koffiMock.textField, koffiMock.targetButton];

		expect(() => performActionByIndex(process.pid, 4, "AXPress")).toThrow("element 4 not found in snapshot");
		expect(koffiMock.accessibilityFunctions.AXUIElementPerformAction).not.toHaveBeenCalled();
	});

	it("#when a cached value target shifts #then the observed field value changes", async () => {
		const { extractAccessibilityTree, setValueByIndex } = await import("./accessibility.js");
		const snapshot = extractAccessibilityTree(process.pid);
		const field = snapshot.elements.find((element) => element.label === "Editable");
		expect(field).toBeDefined();

		koffiMock.windowElement.children = [koffiMock.insertedPrefix, koffiMock.textField, koffiMock.targetButton];
		setValueByIndex(process.pid, field?.id ?? -1, "updated");

		expect(koffiMock.observableState.fieldValue).toBe("updated");
		expect(koffiMock.observableState.pressCount).toBe(0);
	});

	it("#when a cached selection target shifts #then selection applies to the observed field", async () => {
		const { extractAccessibilityTree } = await import("./accessibility.js");
		const { selectTextByIndex } = await import("./select-text.js");
		const snapshot = extractAccessibilityTree(process.pid);
		const field = snapshot.elements.find((element) => element.label === "Editable");
		expect(field).toBeDefined();

		koffiMock.windowElement.children = [koffiMock.insertedPrefix, koffiMock.textField, koffiMock.targetButton];
		selectTextByIndex(process.pid, field?.id ?? -1, { selection: "text", text: "nit" });

		expect(koffiMock.observableState.selection).toEqual({ location: 1, length: 3 });
		expect(koffiMock.observableState.pressCount).toBe(0);
	});

	it("#when AXPress is unsupported #then the native error is preserved and the snapshot remains usable", async () => {
		const { extractAccessibilityTree, performActionByIndex } = await import("./accessibility.js");
		const snapshot = extractAccessibilityTree(process.pid);
		const field = snapshot.elements.find((element) => element.label === "Editable");
		const button = snapshot.elements.find((element) => element.label === "Target Button");

		expect(() => performActionByIndex(process.pid, field?.id ?? -1, "AXPress")).toThrow(
			"AXUIElementPerformAction failed with AXError -25206",
		);
		performActionByIndex(process.pid, button?.id ?? -1, "AXPress");
		expect(koffiMock.observableState.pressCount).toBe(1);
	});
});

describe("#given retained accessibility snapshots", () => {
	it("#when explicitly released #then every snapshot reference is released once and fresh-walk fallback resumes", async () => {
		const { extractAccessibilityTree, performActionByIndex, releaseAccessibilitySnapshot } = await import(
			"./accessibility.js"
		);
		extractAccessibilityTree(process.pid);
		expect(koffiMock.coreFoundationFunctions.CFRetain).toHaveBeenCalledTimes(8);
		koffiMock.coreFoundationFunctions.CFRelease.mockClear();

		releaseAccessibilitySnapshot(process.pid);

		expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledTimes(4);
		for (const element of [
			koffiMock.applicationElement,
			koffiMock.windowElement,
			koffiMock.textField,
			koffiMock.targetButton,
		]) {
			expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledWith(element);
		}
		releaseAccessibilitySnapshot(process.pid);
		expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledTimes(4);

		koffiMock.windowElement.children = [koffiMock.insertedPrefix, koffiMock.textField, koffiMock.targetButton];
		performActionByIndex(process.pid, 4, "AXPress");
		expect(koffiMock.observableState.pressCount).toBe(1);
	});

	it("#when the observed pid dies #then action lookup invalidates and releases its snapshot", async () => {
		const { extractAccessibilityTree, performActionByIndex } = await import("./accessibility.js");
		extractAccessibilityTree(process.pid);
		koffiMock.coreFoundationFunctions.CFRelease.mockClear();
		const kill = vi.spyOn(process, "kill").mockImplementation(() => {
			throw new Error("process is gone");
		});
		try {
			expect(() => performActionByIndex(process.pid, 3, "AXPress")).toThrow(
				`invalid process or element index: ${process.pid}:3`,
			);
		} finally {
			kill.mockRestore();
		}
		expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledTimes(4);
		expect(koffiMock.accessibilityFunctions.AXUIElementPerformAction).not.toHaveBeenCalled();
	});

	it("#when accessibility becomes unavailable #then extraction invalidates and releases its snapshot", async () => {
		const { extractAccessibilityTree } = await import("./accessibility.js");
		extractAccessibilityTree(process.pid);
		koffiMock.coreFoundationFunctions.CFRelease.mockClear();
		koffiMock.accessibilityFunctions.AXIsProcessTrusted.mockReturnValue(false);

		expect(extractAccessibilityTree(process.pid)).toEqual({ elements: [], axAvailable: false });
		expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledTimes(4);
	});
});
