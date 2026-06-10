import type { Point } from "../types/index.js";

export class VirtualPointer {
	private x: number;
	private y: number;
	private shown: boolean;

	constructor(seed: Point) {
		this.x = seed.x;
		this.y = seed.y;
		this.shown = false;
	}

	position(): Point {
		return { x: this.x, y: this.y };
	}

	isVisible(): boolean {
		return this.shown;
	}

	moveTo(point: Point): void {
		this.x = point.x;
		this.y = point.y;
		this.shown = true;
	}

	hide(): void {
		this.shown = false;
	}
}
