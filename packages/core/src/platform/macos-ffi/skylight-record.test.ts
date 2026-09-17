import { describe, expect, it } from "vitest";
import { CGS_EVENT_LEFT_MOUSE_DOWN, CGS_EVENT_LEFT_MOUSE_DRAGGED, buildMouseEventRecord } from "./skylight.js";

const window = { id: 4242, bounds: { x: 100, y: 200, width: 300, height: 600 } };

describe("#given a window and a point on screen #when a delivered mouse record is built #then it carries the layout the window server reads", () => {
	it("writes the record length, the flag byte, the event type, the window id and both locations", () => {
		const record = buildMouseEventRecord(window, CGS_EVENT_LEFT_MOUSE_DOWN, { x: 180, y: 500 });

		expect(record.byteLength).toBe(0xf8);
		expect(record[0x04]).toBe(0xf8);
		expect(record[0x3a]).toBe(0x10);
		expect(record[0x08]).toBe(CGS_EVENT_LEFT_MOUSE_DOWN);
		expect(record.readUInt32LE(0x3c)).toBe(4242);
		expect(record.readDoubleLE(0x10)).toBe(180);
		expect(record.readDoubleLE(0x18)).toBe(500);
		// Window-local coordinates are the difference between the point and the window origin.
		expect(record.readDoubleLE(0x20)).toBe(80);
		expect(record.readDoubleLE(0x28)).toBe(300);
	});

	it("encodes the dragged event type separately from the press", () => {
		const record = buildMouseEventRecord(window, CGS_EVENT_LEFT_MOUSE_DRAGGED, { x: 120, y: 260 });

		expect(record[0x08]).toBe(CGS_EVENT_LEFT_MOUSE_DRAGGED);
		expect(record.readDoubleLE(0x20)).toBe(20);
		expect(record.readDoubleLE(0x28)).toBe(60);
	});
});
