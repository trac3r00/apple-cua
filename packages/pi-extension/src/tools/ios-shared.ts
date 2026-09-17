import { IPhoneMirroring, requireMirroringSession } from "@apple-cua/core";
import { type ToolDefinition, defineTool } from "../pi/index.js";
import { textResult } from "./result.js";

export class PhoneObservationKeys {
	private observationWindowId: number | undefined;

	record(windowId: number): void {
		this.observationWindowId = windowId;
	}

	async assertCurrent(): Promise<void> {
		if (this.observationWindowId === undefined) {
			throw new Error(
				"no iPhone observation is recorded in this session; call ios_observe before acting on the phone",
			);
		}
		const session = await requireMirroringSession();
		if (session.window.id !== this.observationWindowId) {
			throw new Error(
				"the iPhone observation is stale because the mirroring window changed; call ios_observe before acting on the phone",
			);
		}
	}
}

export function phoneTool(
	name: string,
	label: string,
	description: string,
	parameters: any,
	keys: PhoneObservationKeys,
	action: (phone: IPhoneMirroring, params: any) => Promise<unknown>,
): ToolDefinition {
	return defineTool({
		name,
		label,
		description,
		parameters,
		async execute(_toolCallId, params) {
			await keys.assertCurrent();
			const phone = new IPhoneMirroring();
			const details = await action(phone, params);
			return textResult("Action completed on iPhone. Call ios_observe to inspect the updated screen.", details);
		},
	});
}

export function phonePoint(params: { x?: number; y?: number }): { x: number; y: number } {
	if (params.x === undefined || params.y === undefined) {
		throw new Error("iOS tap requires finite x and y coordinates from ios_observe");
	}
	return { x: params.x, y: params.y };
}
