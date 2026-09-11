import { describe, expect, it } from "vitest";

import { classifyContentKind } from "./content-kind.js";
import type { AXTreeElement } from "./types.js";

function el(partial: Partial<AXTreeElement> & { id: number; role: string }): AXTreeElement {
	return {
		label: null,
		value: null,
		frame: { x: 0, y: 0, width: 10, height: 10 },
		actions: [],
		children: [],
		...partial,
	};
}

const WINDOW = { width: 1000, height: 800 };

describe("#given a tree full of descriptive controls #when classifying content #then ax is primary", () => {
	it("returns ax for buttons, text fields, and links", () => {
		const elements = [
			el({ id: 1, role: "AXButton", label: "Save", actions: ["AXPress"] }),
			el({ id: 2, role: "AXTextField", label: "Name", value: "Ada" }),
			el({ id: 3, role: "AXLink", label: "Docs", actions: ["AXPress"] }),
		];

		expect(classifyContentKind(elements, WINDOW)).toBe("ax");
	});
});

describe("#given a tree dominated by one large image #when classifying content #then vision is primary", () => {
	it("returns image when image-role elements cover most of the window", () => {
		const elements = [
			el({ id: 1, role: "AXImage", label: "Photo", frame: { x: 0, y: 0, width: 1000, height: 700 } }),
			el({ id: 2, role: "AXButton", label: "Share", actions: ["AXPress"] }),
		];

		expect(classifyContentKind(elements, WINDOW)).toBe("image");
	});
});

describe("#given an empty tree against a real window #when classifying content #then vision is primary", () => {
	it("returns image when there is nothing for the accessibility tree to offer", () => {
		expect(classifyContentKind([], WINDOW)).toBe("image");
	});
});

describe("#given a small image among controls #when classifying content #then ax stays primary", () => {
	it("returns ax when image area is a minor fraction of the window", () => {
		const elements = [
			el({ id: 1, role: "AXImage", label: "Icon", frame: { x: 0, y: 0, width: 32, height: 32 } }),
			el({ id: 2, role: "AXButton", label: "Save", actions: ["AXPress"] }),
			el({ id: 3, role: "AXStaticText", value: "Hello world" }),
		];

		expect(classifyContentKind(elements, WINDOW)).toBe("ax");
	});
});
