import {
	type DoctorCheck,
	type DoctorFacts,
	type DoctorReport,
	GRANT_COMMAND,
	HELPER_DISPLAY_NAME,
	PRIVACY_PANES,
	evaluateDoctor,
	formatDoctorReport,
} from "./doctor.js";

export type RepairId = "native" | "helper" | "registrations" | "stop" | "permissions";

/**
 * One thing `apple-cua doctor --fix` can do about a report. `auto` repairs are safe to make unasked; rebuilding the
 * helper needs consent because macOS then asks for both permissions again; lifting the stop switch is the person's
 * call; a permission grant only a person can make, so --fix opens the pane where they make it.
 */
export interface Repair {
	readonly id: RepairId;
	readonly kind: "auto" | "consent" | "confirm" | "guide";
	readonly title: string;
}

function notOk(report: DoctorReport, matches: (id: string) => boolean): DoctorCheck[] {
	return report.checks.filter((item) => item.status !== "ok" && matches(item.id));
}

/** The repairs a report calls for, in the order --fix makes them. Pure. */
export function planRepairs(report: DoctorReport): Repair[] {
	const repairs: Repair[] = [];
	if (notOk(report, (id) => id.startsWith("native:") || id === "native-inputs").length > 0) {
		repairs.push({ id: "native", kind: "auto", title: "rebuild the universal native binaries" });
	}
	if (notOk(report, (id) => id === "helper" || id === "helper-inputs" || id === "helper-arch").length > 0) {
		repairs.push({ id: "helper", kind: "consent", title: "rebuild the signed helper app" });
	}
	if (notOk(report, (id) => id.startsWith("client:")).length > 0) {
		repairs.push({ id: "registrations", kind: "auto", title: "register apple-cua again with the saved MCP clients" });
	}
	if (notOk(report, (id) => id === "stop-switch").length > 0) {
		repairs.push({ id: "stop", kind: "confirm", title: "lift the stop switch" });
	}
	if (notOk(report, (id) => id.startsWith("permission:")).length > 0) {
		repairs.push({
			id: "permissions",
			kind: "guide",
			title: `grant the missing permissions to "${HELPER_DISPLAY_NAME}"`,
		});
	}
	return repairs;
}

export interface FixOptions {
	/** Consent to rebuild the helper given up front (--rebuild-helper). */
	readonly rebuildHelper: boolean;
	/** Open System Settings for a missing permission (default); --no-open only prints the command. */
	readonly openPanes: boolean;
	/** A person is at the terminal to answer questions. */
	readonly interactive: boolean;
}

export interface FixDependencies {
	readonly gather: () => DoctorFacts;
	readonly rebuildNative: () => boolean;
	readonly rebuildHelper: () => boolean;
	readonly reapplyRegistrations: () => boolean;
	readonly resume: () => void;
	readonly openUrl: (url: string) => boolean;
	/** Walks a person through macOS's permission dialogs (apple-cua permissions grant); called only when interactive. */
	readonly grantPermissions: () => Promise<{ readonly missing: readonly string[] }>;
	/** Asks a yes/no question; called only when interactive. Defaults to no. */
	readonly ask: (question: string) => Promise<boolean>;
	readonly print: (text: string) => void;
}

export interface FixOutcome {
	readonly fixed: readonly string[];
	readonly skipped: readonly string[];
	readonly failed: readonly string[];
	readonly report: DoctorReport;
}

function paneFor(checkId: string): { readonly url: string; readonly pane: string } | undefined {
	if (checkId === "permission:accessibility") {
		return { url: PRIVACY_PANES.accessibility, pane: "Accessibility" };
	}
	if (checkId === "permission:screen-recording") {
		return { url: PRIVACY_PANES.screenRecording, pane: "Screen & System Audio Recording" };
	}
	return checkId.startsWith("permission:automation:")
		? { url: PRIVACY_PANES.automation, pane: "Automation" }
		: undefined;
}

/**
 * Repairs what is safe to repair, asks before what is not, and reports what is left. Every effect goes through
 * `deps`, so the plan and its consent rules are testable without touching the Mac.
 */
export async function runDoctorFix(options: FixOptions, deps: FixDependencies): Promise<FixOutcome> {
	const facts = deps.gather();
	const before = evaluateDoctor(facts);
	deps.print(formatDoctorReport(before));
	const repairs = planRepairs(before);
	const fixed: string[] = [];
	const skipped: string[] = [];
	const failed: string[] = [];
	if (repairs.length === 0) {
		deps.print("\nNothing for --fix to repair.");
		return { fixed, skipped, failed, report: before };
	}
	deps.print("\nRepairing:");
	for (const repair of repairs) {
		deps.print(`\n- ${repair.title}`);
		switch (repair.id) {
			case "native":
			case "registrations": {
				const ok = repair.id === "native" ? deps.rebuildNative() : deps.reapplyRegistrations();
				(ok ? fixed : failed).push(repair.title);
				break;
			}
			case "helper": {
				const consent =
					options.rebuildHelper ||
					(options.interactive &&
						(await deps.ask(
							"Rebuild the helper app now (a new code identity, so macOS asks for Screen Recording and Accessibility again)",
						)));
				if (!consent) {
					deps.print(
						"  skipped: rebuilding the helper needs your consent, because macOS then asks for Screen Recording and Accessibility again. Run: apple-cua doctor --fix --rebuild-helper",
					);
					skipped.push(`${repair.title} (needs your consent: apple-cua doctor --fix --rebuild-helper)`);
					break;
				}
				(deps.rebuildHelper() ? fixed : failed).push(repair.title);
				break;
			}
			case "stop": {
				const stop = facts.stop;
				const description = stop.stopped ? `${stop.source} at ${stop.stoppedAt}: ${stop.reason}` : "";
				const lift =
					options.interactive &&
					(await deps.ask(`Computer use is stopped (${description}). Lift the stop so agents may act again`));
				if (!lift) {
					deps.print("  skipped: only you decide when agents may act again. Run: apple-cua resume");
					skipped.push(`${repair.title} (your call: apple-cua resume)`);
					break;
				}
				deps.resume();
				fixed.push(repair.title);
				break;
			}
			case "permissions": {
				if (options.interactive) {
					const outcome = await deps.grantPermissions();
					if (outcome.missing.length === 0) {
						fixed.push(repair.title);
					} else {
						skipped.push(`grant ${outcome.missing.join(", ")} (${GRANT_COMMAND})`);
					}
					break;
				}
				const panes = notOk(before, (id) => id.startsWith("permission:")).flatMap((item) => {
					const pane = paneFor(item.id);
					return pane === undefined ? [] : [pane];
				});
				const missing = panes.filter((pane, index) => panes.findIndex((other) => other.url === pane.url) === index);
				// One pane at a time: opening a second one only replaces the first in System Settings.
				let opened = false;
				for (const pane of missing) {
					if (!opened && options.openPanes && deps.openUrl(pane.url)) {
						opened = true;
						deps.print(`  opened System Settings > Privacy & Security > ${pane.pane}`);
					} else {
						deps.print(`  ${opened ? "then " : ""}open ${pane.pane} with: open "${pane.url}"`);
					}
				}
				skipped.push(`grant ${missing.map((pane) => pane.pane).join(" and ")} to "apple-cua-mcp" (only you can)`);
				break;
			}
		}
	}
	const after = evaluateDoctor(deps.gather());
	deps.print(`\n${formatDoctorReport(after)}`);
	const summary = [
		fixed.length === 0 ? undefined : `Fixed: ${fixed.join("; ")}.`,
		skipped.length === 0 ? undefined : `Left for you: ${skipped.join("; ")}.`,
		failed.length === 0 ? undefined : `Failed: ${failed.join("; ")} (see the output above).`,
	].filter((line) => line !== undefined);
	deps.print(`\n${summary.join("\n")}`);
	return { fixed, skipped, failed, report: after };
}
