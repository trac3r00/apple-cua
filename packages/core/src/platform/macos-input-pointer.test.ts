import { describe, expect, it } from "vitest";

import type { Point, Rect } from "../types/index.js";
import { type ScreenLayout, primerPosition } from "./macos-input-pointer.js";

const MAIN: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
const MENU_BAR: Rect = { x: 0, y: 0, width: 1920, height: 25 };
const DOCUMENT: Rect = { x: 200, y: 100, width: 800, height: 600 };
/** A display arranged above and left of the main one, so its area contains (-1, -1). */
const UPPER_LEFT: Rect = { x: -2560, y: -1440, width: 2560, height: 1440 };

function clearOfEverything(layout: ScreenLayout, point: Point): boolean {
	return [...layout.displays, ...layout.windows].every(
		(rect) => point.x < rect.x || point.x > rect.x + rect.width || point.y < rect.y || point.y > rect.y + rect.height,
	);
}

describe("#given the displays and on-screen windows the activation primer must miss", () => {
	it("#when only the main display is attached #then the primer clicks (-1, -1), just above and left of it", () => {
		expect(primerPosition({ displays: [MAIN], windows: [MENU_BAR, DOCUMENT] })).toEqual({ x: -1, y: -1 });
	});

	it("#when a display sits left of the main one but not above it #then (-1, -1) is still clear and kept", () => {
		const layout = { displays: [MAIN, { x: -1920, y: 0, width: 1920, height: 1080 }], windows: [MENU_BAR] };

		expect(primerPosition(layout)).toEqual({ x: -1, y: -1 });
	});

	it("#when a display at a negative origin above and left of the main one covers (-1, -1) #then the primer moves just outside every display and window", () => {
		const layout = {
			displays: [MAIN, UPPER_LEFT],
			windows: [MENU_BAR, DOCUMENT, { x: -1200, y: -900, width: 1199, height: 899 }],
		};

		const point = primerPosition(layout);

		expect(point).toEqual({ x: -2561, y: -1441 });
		expect(point !== undefined && clearOfEverything(layout, point)).toBe(true);
	});

	it("#when a display above the main one starts left of it #then the primer moves past that display's corner", () => {
		const layout = { displays: [MAIN, { x: -500, y: -1080, width: 2560, height: 1080 }], windows: [] };

		expect(primerPosition(layout)).toEqual({ x: -501, y: -1081 });
	});

	it("#when a window hangs over the main display's top-left corner #then the primer clears that window too", () => {
		const layout = { displays: [MAIN], windows: [{ x: -40, y: -30, width: 600, height: 400 }] };

		expect(primerPosition(layout)).toEqual({ x: -41, y: -31 });
	});

	it("#when a window's edge passes exactly through (-1, -1) #then the edge counts as covered", () => {
		const layout = { displays: [MAIN], windows: [{ x: -1, y: -1, width: 10, height: 10 }] };

		expect(primerPosition(layout)).toEqual({ x: -2, y: -2 });
	});

	it("#when a window is parked further out than any display #then the primer clears it as well", () => {
		const layout = { displays: [MAIN, UPPER_LEFT], windows: [{ x: -30_000, y: -20_000, width: 100, height: 100 }] };

		const point = primerPosition(layout);

		expect(point).toEqual({ x: -30_001, y: -20_001 });
		expect(point !== undefined && clearOfEverything(layout, point)).toBe(true);
	});

	it("#when the layout is unknown, names no display, or holds a bound that is not a finite rectangle #then no point is provable", () => {
		expect(primerPosition(undefined)).toBeUndefined();
		expect(primerPosition({ displays: [], windows: [DOCUMENT] })).toBeUndefined();
		expect(primerPosition({ displays: [MAIN], windows: [{ ...DOCUMENT, x: Number.NaN }] })).toBeUndefined();
		expect(primerPosition({ displays: [{ ...MAIN, width: Number.POSITIVE_INFINITY }], windows: [] })).toBeUndefined();
		expect(primerPosition({ displays: [MAIN], windows: [{ ...DOCUMENT, width: -5 }] })).toBeUndefined();
	});

	it("#when coordinates are so large that stepping one point past them changes nothing #then no point is provable", () => {
		const huge = 2 ** 53;
		const layout = { displays: [{ x: -huge, y: -huge, width: 2 * huge, height: 2 * huge }], windows: [] };

		expect(primerPosition(layout)).toBeUndefined();
	});
});
