import { describe, expect, it, vi } from "vitest";
import { type RecognizeBindings, recognizeWithBindings } from "./vision.js";

interface FakeVision {
	readonly bindings: RecognizeBindings;
	readonly handler: object;
	readonly request: object;
	readonly requests: object;
	readonly released: object[];
}

function fakeVision(performSucceeds: boolean): FakeVision {
	const handler = { name: "handler" };
	const request = { name: "request" };
	const requests = { name: "requests" };
	const released: object[] = [];
	const bindings: RecognizeBindings = {
		selector: (name) => ({ selector: name }),
		imageRequestHandlerClass: {},
		recognizeTextRequestClass: {},
		mutableArrayClass: {},
		stringClass: {},
		alloc: () => ({}),
		initTextRequest: () => request,
		initHandlerWithImage: () => handler,
		setRecognitionLevel: vi.fn(),
		setUsesLanguageCorrection: vi.fn(),
		setRecognitionLanguages: vi.fn(),
		arrayWithCapacity: () => requests,
		addObject: vi.fn(),
		stringWithUtf8: () => null,
		performRequests: () => performSucceeds,
		release: (receiver) => {
			released.push(receiver);
		},
		results: () => null,
		count: () => 0,
		objectAtIndex: () => null,
		boundingBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
		topCandidates: () => null,
		string: () => null,
		utf8String: () => "",
		confidence: () => 0,
	};
	return { bindings, handler, request, requests, released };
}

describe("#given a Vision request #when recognition runs #then every native object it created is released exactly once", () => {
	it("releases the request array, the request and the handler when recognition succeeds", () => {
		const fake = fakeVision(true);

		const observations = recognizeWithBindings(fake.bindings, {}, {}, 10, 10);

		expect(observations).toEqual([]);
		expect(fake.released).toHaveLength(3);
		expect(fake.released).toEqual(expect.arrayContaining([fake.requests, fake.request, fake.handler]));
	});

	it("releases the request array, the request and the handler when performRequests fails", () => {
		const fake = fakeVision(false);

		expect(() => recognizeWithBindings(fake.bindings, {}, {}, 10, 10)).toThrow(/Vision text recognition failed/);

		expect(fake.released).toHaveLength(3);
		expect(fake.released).toEqual(expect.arrayContaining([fake.requests, fake.request, fake.handler]));
	});

	it("does not release a request array that was never built", () => {
		const fake = fakeVision(true);
		const bindings: RecognizeBindings = { ...fake.bindings, arrayWithCapacity: () => null };

		expect(() => recognizeWithBindings(bindings, {}, {}, 10, 10)).toThrow(/could not build the Vision request list/);

		expect(fake.released).toHaveLength(2);
		expect(fake.released).toEqual(expect.arrayContaining([fake.request, fake.handler]));
	});
});
