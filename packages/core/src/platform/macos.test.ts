import { describe, expect, it } from "vitest";
import { parsePngDimensions } from "./macos.js";

function createFakePng(): Buffer {
	const data = globalThis.Buffer.alloc(24);
	data.write("\u0089PNG\r\n\u001a\n", 0, "latin1");
	data.writeUInt32BE(1920, 16);
	data.writeUInt32BE(1080, 20);
	return data;
}

describe("#given macos screenshot capture returns a png buffer", () => {
	describe("#when dimensions are parsed from the screenshot bytes", () => {
		it("#then parses dimensions from the png IHDR chunk", async () => {
			const fakePng = createFakePng();

			const result = parsePngDimensions(fakePng);

			expect(result.width).toBe(1920);
			expect(result.height).toBe(1080);
		});
	});
});
