export type AppApprovalDecision = "approved" | "needs-approval" | "denied";

export class AppApprovalStore {
	private readonly sessionApproved = new Set<string>();
	private readonly persistentApproved = new Set<string>();
	private readonly denied = new Set<string>();

	constructor(persistentApproved: Iterable<string> = []) {
		for (const bundleId of persistentApproved) {
			this.persistentApproved.add(bundleId.toLowerCase());
		}
	}

	decide(bundleId: string): AppApprovalDecision {
		const key = bundleId.toLowerCase();
		if (this.denied.has(key)) {
			return "denied";
		}
		if (this.sessionApproved.has(key) || this.persistentApproved.has(key)) {
			return "approved";
		}
		return "needs-approval";
	}

	approveForSession(bundleId: string): void {
		this.sessionApproved.add(bundleId.toLowerCase());
	}

	approvePersistent(bundleId: string): void {
		this.persistentApproved.add(bundleId.toLowerCase());
	}

	deny(bundleId: string): void {
		this.denied.add(bundleId.toLowerCase());
	}
}
