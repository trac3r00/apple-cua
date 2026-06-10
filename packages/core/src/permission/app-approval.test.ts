import { describe, expect, it } from "vitest";

import { AppApprovalStore } from "./app-approval.js";

describe("#given a fresh store #when deciding an unknown app #then approval is required", () => {
	it("defaults to needs-approval", () => {
		expect(new AppApprovalStore().decide("com.example.app")).toBe("needs-approval");
	});
});

describe("#given session and persistent approvals #when deciding #then the app is approved", () => {
	it("approves a session-approved app", () => {
		const store = new AppApprovalStore();
		store.approveForSession("com.example.app");
		expect(store.decide("com.example.app")).toBe("approved");
	});

	it("approves a persistently seeded app case-insensitively", () => {
		expect(new AppApprovalStore(["com.example.app"]).decide("COM.EXAMPLE.APP")).toBe("approved");
	});
});

describe("#given a denied app #when deciding #then denial overrides any approval", () => {
	it("reports denied even after approval", () => {
		const store = new AppApprovalStore();
		store.approveForSession("com.example.app");
		store.deny("com.example.app");
		expect(store.decide("com.example.app")).toBe("denied");
	});
});
