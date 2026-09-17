import { describe, expect, it } from "vitest";
import * as core from "./index.js";

describe("#given macos host computer", () => {
	describe("#when instantiated", () => {
		it("#then has correct capabilities", () => {
			const computer = new core.MacOSHostComputer();
			expect(computer.capabilities.supportsScreenshot).toBe(true);
			expect(computer.capabilities.supportsInput).toBe(true);
			expect(computer.capabilities.supportsAccessibility).toBe(true);
			expect(computer.capabilities.supportsClipboard).toBe(true);
		});
	});
});

describe("#given the package entry point #when the phone capability is imported the way consumers import it #then the API is actually reachable", () => {
	it("exports the iPhone Mirroring surface", () => {
		expect(typeof core.IPhoneMirroring).toBe("function");
		expect(typeof core.observeMirroring).toBe("function");
		expect(typeof core.mirroringSessionStatus).toBe("function");
		expect(typeof core.describeMirroringState).toBe("function");
		expect(typeof core.requireMirroringSession).toBe("function");
		expect(typeof core.classifyMirroringSession).toBe("function");
		expect(typeof core.selectMirroringWindow).toBe("function");
		expect(typeof core.windowOwnsPoint).toBe("function");
		expect(core.IPHONE_MIRRORING_BUNDLE_ID).toBe("com.apple.ScreenContinuity");
	});

	it("exports the input primitives the surfaces build on", () => {
		expect(typeof core.gesturePath).toBe("function");
		expect(typeof core.typingPlan).toBe("function");
		expect(typeof core.comboParts).toBe("function");
		expect(typeof core.tapMirroring).toBe("function");
		expect(typeof core.typeIntoMirroring).toBe("function");
	});

	it("exports the OCR surface and the renamed-environment helper", () => {
		expect(typeof core.recognizeTextInImage).toBe("function");
		expect(typeof core.readImagePixelSize).toBe("function");
		expect(typeof core.renamedEnvironmentVariable).toBe("function");
	});
});
