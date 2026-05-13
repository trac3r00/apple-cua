export type PermissionKind = "screen" | "accessibility" | "input-monitoring" | "apple-events";

export type PermissionStatus = "not-determined" | "denied" | "authorized" | "restricted";

export interface PermissionInterface {
	check(kind: PermissionKind): Promise<PermissionStatus>;

	/**
	 * Request a macOS privacy permission prompt.
	 *
	 * Apple Events requires a target bundle identifier, supplied as the optional
	 * second argument for v0.1 while the public interface remains minimal.
	 */
	request(kind: PermissionKind, bundleId?: string): Promise<void>;
}
