import { describe, expect, it } from "vitest";

import { resolveDisplayMetadata } from "./display-metadata.js";

describe("#given a Retina display #when resolving metadata #then the backing scale factor is reported", () => {
	it("derives scaleFactor from native pixels over logical points", () => {
		const metadata = resolveDisplayMetadata({
			logical: { width: 2560, height: 1440 },
			nativePixel: { width: 5120, height: 2880 },
		});

		expect(metadata).toEqual({ width: 2560, height: 1440, scaleFactor: 2 });
	});
});

describe("#given a non-Retina display #when resolving metadata #then the scale factor is one", () => {
	it("reports scaleFactor 1 when native pixels equal logical points", () => {
		const metadata = resolveDisplayMetadata({
			logical: { width: 1920, height: 1080 },
			nativePixel: { width: 1920, height: 1080 },
		});

		expect(metadata).toEqual({ width: 1920, height: 1080, scaleFactor: 1 });
	});
});

describe("#given native pixels are unavailable #when resolving metadata #then it falls back to scale one", () => {
	it("defaults scaleFactor to 1 without native pixel sizing", () => {
		const metadata = resolveDisplayMetadata({ logical: { width: 1512, height: 982 } });

		expect(metadata).toEqual({ width: 1512, height: 982, scaleFactor: 1 });
	});
});

describe("#given a fractional native ratio #when resolving metadata #then the scale factor rounds to the nearest integer", () => {
	it("rounds an imperfect native/logical ratio", () => {
		const metadata = resolveDisplayMetadata({
			logical: { width: 1512, height: 982 },
			nativePixel: { width: 3024, height: 1964 },
		});

		expect(metadata.scaleFactor).toBe(2);
	});
});
