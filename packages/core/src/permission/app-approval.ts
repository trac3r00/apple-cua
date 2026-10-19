export type AppApprovalDecision = "approved" | "needs-approval" | "denied";

export class AppApprovalStore {
	private readonly sessionApproved = new Set<string>();
	private readonly persistentApproved = new Set<string>();
	private readonly denied = new Set<string>();
	private readonly unrestricted: boolean;

	/** Omit the restriction to allow any explicitly targeted app; an empty iterable allows none. */
	constructor(persistentApproved?: Iterable<string>) {
		this.unrestricted = persistentApproved === undefined;
		for (const bundleId of persistentApproved ?? []) {
			this.persistentApproved.add(bundleId.toLowerCase());
		}
	}

	decide(bundleId: string): AppApprovalDecision {
		const key = bundleId.toLowerCase();
		if (this.denied.has(key)) {
			return "denied";
		}
		if (key.trim().length === 0) {
			return "needs-approval";
		}
		if (this.unrestricted || this.sessionApproved.has(key) || this.persistentApproved.has(key)) {
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
