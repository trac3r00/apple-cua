import type { KoffiFunc } from "koffi";
import { withCFString } from "./corefoundation.js";
import { koffi } from "./koffi.js";

export interface DisplaySleepAssertion {
	acquire(): void;
	release(): void;
}

export interface AssertionBinding {
	create(reason: string): number | undefined;
	release(id: number): void;
}

export const NOOP_DISPLAY_SLEEP: DisplaySleepAssertion = {
	acquire(): void {},
	release(): void {},
};

const ASSERTION_REASON = "macos-cua Computer Use";

export function createDisplaySleepAssertion(binding: AssertionBinding = defaultBinding): DisplaySleepAssertion {
	let assertionId: number | undefined;
	return {
		acquire(): void {
			if (assertionId !== undefined) {
				return;
			}
			try {
				assertionId = binding.create(ASSERTION_REASON);
			} catch {
				assertionId = undefined;
			}
		},
		release(): void {
			if (assertionId === undefined) {
				return;
			}
			try {
				binding.release(assertionId);
			} catch {}
			assertionId = undefined;
		},
	};
}

const ioKit = koffi.load("/System/Library/Frameworks/IOKit.framework/IOKit");
const K_IOPM_ASSERTION_LEVEL_ON = 255;
const ASSERTION_TYPE = "PreventUserIdleDisplaySleep";

const IOPMAssertionCreateWithName = ioKit.func(
	"int IOPMAssertionCreateWithName(void* assertionType, uint32_t assertionLevel, void* assertionName, _Out_ uint32_t* assertionID)",
) as KoffiFunc<(type: unknown, level: number, name: unknown, idOut: Uint32Array) => number>;

const IOPMAssertionRelease = ioKit.func("IOPMAssertionRelease", "int", ["uint32_t"]) as KoffiFunc<
	(id: number) => number
>;

const defaultBinding: AssertionBinding = {
	create(reason: string): number | undefined {
		return withCFString(ASSERTION_TYPE, (type) =>
			withCFString(reason, (name) => {
				const idOut = new Uint32Array(1);
				const result = IOPMAssertionCreateWithName(type, K_IOPM_ASSERTION_LEVEL_ON, name, idOut);
				return result === 0 ? idOut[0] : undefined;
			}),
		);
	},
	release(id: number): void {
		IOPMAssertionRelease(id);
	},
};

export { ASSERTION_REASON };
