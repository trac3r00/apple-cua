export interface WindowInfo {
	readonly id: number;
	readonly title: string;
	readonly bundleId?: string;
	readonly processId: number;
	readonly bounds: { x: number; y: number; width: number; height: number };
	readonly url?: string;
}

export interface WindowInterface {
	active(): Promise<WindowInfo | null>;
	list(): Promise<readonly WindowInfo[]>;
	activate(bundleIdOrName: string): Promise<void>;
}
