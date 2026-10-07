import type {
	ClickOptions,
	ComputerUseResult,
	KeyEntry,
	NativeComputer,
	Point,
} from "../../src/computer-use/native-computer.js";

export type ComputerCall =
	| { readonly method: "screenshot" }
	| { readonly method: "click"; readonly point: Point; readonly options: ClickOptions }
	| { readonly method: "drag"; readonly from: Point; readonly to: Point }
	| { readonly method: "typeText"; readonly text: string }
	| { readonly method: "pressKeys"; readonly keys: readonly KeyEntry[] }
	| { readonly method: "wait"; readonly milliseconds: number };

/** A NativeComputer that only records what an executor asked of it. */
export class RecordingComputer implements NativeComputer {
	readonly calls: ComputerCall[] = [];

	async screenshot(): Promise<ComputerUseResult> {
		this.calls.push({ method: "screenshot" });
		return answer("screenshot");
	}

	async click(point: Point, options: ClickOptions): Promise<ComputerUseResult> {
		this.calls.push({ method: "click", point, options });
		return answer("click");
	}

	async drag(from: Point, to: Point): Promise<ComputerUseResult> {
		this.calls.push({ method: "drag", from, to });
		return answer("drag");
	}

	async typeText(text: string): Promise<ComputerUseResult> {
		this.calls.push({ method: "typeText", text });
		return answer("typeText");
	}

	async pressKeys(keys: readonly KeyEntry[]): Promise<ComputerUseResult> {
		this.calls.push({ method: "pressKeys", keys });
		return answer("pressKeys");
	}

	async wait(milliseconds: number): Promise<void> {
		this.calls.push({ method: "wait", milliseconds });
	}
}

function answer(method: string): ComputerUseResult {
	return { content: [{ type: "text", text: method }], details: undefined };
}
