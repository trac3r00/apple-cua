import type { AutomationStatus } from "@apple-cua/core";
import { GRANT_COMMAND, HELPER_DISPLAY_NAME, PRIVACY_PANES, automationAppName } from "./doctor.js";

/** What the helper holds, read without raising a prompt (server.js --doctor through the helper). */
export interface HelperPermissions {
	readonly accessibility: boolean;
	readonly screenRecording: boolean;
	readonly automation: Readonly<Record<string, AutomationStatus>>;
}

/** What server.js --request-permissions answered; only the kinds that were asked for are present. */
export interface PermissionRequestAnswer {
	readonly accessibility?: boolean;
	readonly screenRecording?: boolean;
	readonly automation?: Readonly<Record<string, AutomationStatus>>;
}

export interface GrantDependencies {
	readonly read: () => HelperPermissions | undefined;
	/** Shows macOS's dialogs for the helper; an Automation dialog blocks until it is answered. */
	readonly request: (kinds: readonly string[]) => PermissionRequestAnswer | undefined;
	readonly openUrl: (url: string) => Promise<boolean>;
	/** Re-checks until `granted` holds or the person skips; true when it holds. */
	readonly waitFor: (granted: () => boolean) => Promise<boolean>;
	readonly print: (text: string) => void;
}

export interface GrantOptions {
	readonly interactive: boolean;
	readonly openPanes: boolean;
	/** Apps beyond the helper's own Automation targets to ask about, e.g. approved browsers. */
	readonly extraAutomationTargets: readonly string[];
}

export interface GrantOutcome {
	readonly granted: readonly string[];
	readonly missing: readonly string[];
	readonly notAsked: readonly string[];
}

const NAME = `"${HELPER_DISPLAY_NAME}"`;

/**
 * Walks a person through every permission the helper needs: shows macOS's own dialog (which also lists the helper in
 * System Settings), opens the pane where the switch is, and waits until it is on. Without a person it only reports
 * what is missing and how to grant it.
 */
export async function grantPermissions(options: GrantOptions, deps: GrantDependencies): Promise<GrantOutcome> {
	const state = deps.read();
	const granted: string[] = [];
	const missing: string[] = [];
	const notAsked: string[] = [];
	if (state === undefined) {
		deps.print(`Cannot read the permissions of ${NAME}: the helper app did not answer. Run apple-cua doctor.`);
		return { granted, missing: ["Accessibility", "Screen Recording"], notAsked };
	}
	const targets = [
		...new Set([...Object.keys(state.automation), ...options.extraAutomationTargets.map((id) => id.toLowerCase())]),
	];
	const open = async (url: string, pane: string) => {
		if (options.openPanes && (await deps.openUrl(url))) {
			deps.print(`  Opened System Settings > Privacy & Security > ${pane}.`);
		} else {
			deps.print(`  Open System Settings > Privacy & Security > ${pane} with: open "${url}"`);
		}
	};

	const grants = [
		{
			label: "Accessibility",
			pane: "Accessibility",
			url: PRIVACY_PANES.accessibility,
			kind: "accessibility",
			why: "read app windows and send clicks and keys",
			has: (current: HelperPermissions | undefined) => current?.accessibility === true,
		},
		{
			label: "Screen Recording",
			pane: "Screen & System Audio Recording",
			url: PRIVACY_PANES.screenRecording,
			kind: "screen-recording",
			why: "take screenshots of app windows",
			has: (current: HelperPermissions | undefined) => current?.screenRecording === true,
		},
	] as const;

	for (const grant of grants) {
		if (grant.has(state)) {
			deps.print(`ok  ${grant.label} is granted to ${NAME}.`);
			continue;
		}
		if (!options.interactive) {
			deps.print(`missing  ${grant.label} for ${NAME}: run ${GRANT_COMMAND} in a terminal.`);
			missing.push(grant.label);
			continue;
		}
		deps.print(`\n${grant.label} lets ${NAME} ${grant.why}.`);
		deps.print(`  macOS shows a dialog for ${NAME}: choose Open System Settings, then switch on ${NAME}.`);
		deps.request([grant.kind]);
		await open(grant.url, grant.pane);
		deps.print("  Waiting until it is on (press Enter to skip)...");
		if (await deps.waitFor(() => grant.has(deps.read()))) {
			deps.print(`  ok  ${grant.label} is granted.`);
			granted.push(grant.label);
		} else {
			deps.print(`  skipped: grant it later with ${GRANT_COMMAND}`);
			missing.push(grant.label);
		}
	}

	for (const bundleId of targets) {
		const app = automationAppName(bundleId);
		const label = `Automation of ${app}`;
		const statusOf = (ask: boolean) =>
			deps.request([`${ask ? "automation" : "automation-status"}:${bundleId}`])?.automation?.[bundleId] ?? "unknown";
		if (state.automation[bundleId] === "granted") {
			deps.print(`ok  ${NAME} may control ${app}.`);
			continue;
		}
		if (!options.interactive) {
			deps.print(`missing  ${label} for ${NAME}: run ${GRANT_COMMAND} in a terminal.`);
			missing.push(label);
			continue;
		}
		deps.print(`\n${NAME} sends Apple Events to ${app}; macOS asks once whether it may.`);
		deps.print(`  If macOS asks "${HELPER_DISPLAY_NAME}" wants access to control "${app}", choose Allow.`);
		const status = statusOf(true);
		if (status === "granted") {
			deps.print(`  ok  ${NAME} may control ${app}.`);
			granted.push(label);
		} else if (status === "not-running" || status === "unknown") {
			deps.print(`  not asked: ${app} is not running; macOS asks the first time an agent uses it.`);
			notAsked.push(label);
		} else if (status === "not-determined") {
			deps.print(`  macOS recorded no answer (the dialog was closed); run ${GRANT_COMMAND} to be asked again.`);
			missing.push(label);
		} else {
			deps.print(`  ${NAME} is not allowed to control ${app}; switch ${app} on under ${NAME}.`);
			await open(PRIVACY_PANES.automation, "Automation");
			deps.print("  Waiting until it is on (press Enter to skip)...");
			if (await deps.waitFor(() => statusOf(false) === "granted")) {
				deps.print(`  ok  ${NAME} may control ${app}.`);
				granted.push(label);
			} else {
				deps.print("  skipped: switch it on later in System Settings > Privacy & Security > Automation");
				missing.push(label);
			}
		}
	}

	if (granted.length > 0) {
		deps.print("\nRestart your MCP clients so running apple-cua servers pick up the new permissions.");
	}
	return { granted, missing, notAsked };
}
