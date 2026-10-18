import type { Point } from "../types/index.js";

export class VirtualPointerSet {
	private readonly pointers = new Map<number, VirtualPointer>();
	private readonly seed: Point;

	constructor(seed: Point) {
		this.seed = seed;
	}

	forPid(pid: number): VirtualPointer {
		let pointer = this.pointers.get(pid);
		if (pointer === undefined) {
			pointer = new VirtualPointer(this.seed);
			this.pointers.set(pid, pointer);
		}
		return pointer;
	}
}

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
