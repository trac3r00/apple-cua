import { describe, expect, it } from "bun:test";

import { AppApprovalStore } from "./app-approval.js";

describe("#given a fresh store #when deciding a named app #then no whitelist is required", () => {
	it("approves an app without preconfiguration", () => {
		expect(new AppApprovalStore().decide("com.example.app")).toBe("approved");
	});

	it.each(["", "   "])("requires an explicit nonempty app identity: %j", (bundleId) => {
		expect(new AppApprovalStore().decide(bundleId)).toBe("needs-approval");
	});

	it("keeps an explicitly empty restriction closed", () => {
		expect(new AppApprovalStore([]).decide("com.example.app")).toBe("needs-approval");
	});

	it("does not extend a configured restriction to other apps or helpers", () => {
		const store = new AppApprovalStore(["com.example.app"]);
		expect(store.decide("com.example.other")).toBe("needs-approval");
		expect(store.decide("com.example.app.helper")).toBe("needs-approval");
	});
});

describe("#given session and persistent approvals #when deciding #then the app is approved", () => {
	it("approves a session-approved app", () => {
		const store = new AppApprovalStore([]);
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

	it("reports denied in the unrestricted default mode", () => {
		const store = new AppApprovalStore();
		store.deny("com.example.app");
		expect(store.decide("COM.EXAMPLE.APP")).toBe("denied");
	});
});
