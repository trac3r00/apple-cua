import { beforeEach, describe, expect, it, vi } from "vitest";

const ffiMock = vi.hoisted(() => {
	const poolAllocation = { type: "pool-allocation" };
	const pool = { type: "pool" };
	const workspace = { type: "workspace" };
	const runningApplicationClass = { type: "class", name: "NSRunningApplication" };
	const bundleClass = { type: "class", name: "NSBundle" };
	const stringClass = { type: "class", name: "NSString" };
	const finder = { type: "application", name: "Finder" };
	const backgroundAgent = { type: "application", name: "Agent" };
	const applications = { type: "array", values: [backgroundAgent, finder] };
	const finderApplications = { type: "array", values: [finder] };
	const noApplications = { type: "array", values: [] };
	const finderUrl = { type: "url" };
	const finderBundle = { type: "bundle" };
	const classes = new Map<string, object>([
		["NSAutoreleasePool", { type: "class", name: "NSAutoreleasePool" }],
		["NSBundle", bundleClass],
		["NSRunningApplication", runningApplicationClass],
		["NSString", stringClass],
		["NSWorkspace", { type: "class", name: "NSWorkspace" }],
	]);
	const string = (value: string) => ({ type: "string", value });
	const send = vi.fn((receiver: unknown, selector: unknown, value?: unknown): unknown => {
		if (selector === "alloc") return poolAllocation;
		if (receiver === poolAllocation && selector === "init") return pool;
		if (receiver === pool && selector === "release") return null;
		if (selector === "sharedWorkspace") return workspace;
		if (receiver === workspace && selector === "runningApplications") return applications;
		if (receiver === runningApplicationClass && selector === "runningApplicationWithProcessIdentifier:") {
			return value === 489 ? finder : null;
		}
		if (receiver === runningApplicationClass && selector === "runningApplicationsWithBundleIdentifier:") {
			return isString(value, "com.apple.finder") ? finderApplications : noApplications;
		}
		if (receiver === workspace && selector === "fullPathForApplication:") {
			return isString(value, "Finder") ? string("/System/Library/CoreServices/Finder.app") : null;
		}
		if (receiver === bundleClass && selector === "bundleWithPath:") return finderBundle;
		if (receiver === finderBundle && selector === "bundleIdentifier") return string("com.apple.finder");
		if (receiver === stringClass && selector === "stringWithUTF8String:") {
			return typeof value === "string" ? string(value) : null;
		}
		if (isArray(receiver) && selector === "count") return receiver.values.length;
		if (isArray(receiver) && selector === "objectAtIndex:") return receiver.values[Number(value)] ?? null;
		if (receiver === backgroundAgent && selector === "activationPolicy") return 1;
		if (receiver === finder && selector === "activationPolicy") return 0;
		if (receiver === finder && selector === "localizedName") return string("Finder");
		if (receiver === finder && selector === "bundleIdentifier") return string("com.apple.finder");
		if (receiver === finder && selector === "processIdentifier") return 489;
		if (receiver === finder && selector === "isActive") return true;
		if (receiver === finder && selector === "bundleURL") return finderUrl;
		if (receiver === finderUrl && selector === "path") return string("/System/Library/CoreServices/Finder.app");
		if (isString(receiver) && selector === "UTF8String") return receiver.value;
		return null;
	});
	const func = vi.fn((name: string) => {
		if (name === "objc_getClass") return (className: string) => classes.get(className) ?? null;
		if (name === "sel_registerName") return (selector: string) => selector;
		if (name === "objc_msgSend") return send;
		throw new Error(`unexpected Objective-C function: ${name}`);
	});
	return {
		module: {
			load: vi.fn((path: string) => (path.includes("libobjc") ? { func } : {})),
		},
		pool,
		send,
	};

	function isArray(value: unknown): value is { readonly type: "array"; readonly values: readonly object[] } {
		return typeof value === "object" && value !== null && Reflect.get(value, "type") === "array";
	}

	function isString(value: unknown, expected?: string): value is { readonly type: "string"; readonly value: string } {
		return (
			typeof value === "object" &&
			value !== null &&
			Reflect.get(value, "type") === "string" &&
			(expected === undefined || Reflect.get(value, "value") === expected)
		);
	}
});

vi.mock("koffi", () => ffiMock.module);

import { findRunningApplication, getRunningApplications } from "./workspace.js";

beforeEach(() => {
	ffiMock.send.mockClear();
});

describe("#given mocked NSWorkspace applications #when enumerating #then foreground properties are read safely", () => {
	it("maps AppKit properties, filters background agents, and releases the autorelease pool", () => {
		const applications = getRunningApplications();

		expect(applications).toEqual([
			{
				name: "Finder",
				bundleId: "com.apple.finder",
				pid: 489,
				isActive: true,
				path: "/System/Library/CoreServices/Finder.app",
			},
		]);
		expect(ffiMock.send).toHaveBeenCalledWith(ffiMock.pool, "release");
	});
});

describe("#given a pid, bundle identifier, or application name #when looking up one app #then no full enumeration occurs", () => {
	it.each([489, "com.apple.finder", "Finder"])("resolves %s through a targeted AppKit selector", (identifier) => {
		const application = findRunningApplication(identifier);

		expect(application?.bundleId).toBe("com.apple.finder");
		expect(application?.pid).toBe(489);
		expect(ffiMock.send).not.toHaveBeenCalledWith(expect.anything(), "runningApplications");
		expect(ffiMock.send).toHaveBeenCalledWith(ffiMock.pool, "release");
	});
});
