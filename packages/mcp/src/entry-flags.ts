// Command-line flags of the server entry point, kept apart from self-check.ts so the entry can read them without
// loading the native core.
/** `server.js --doctor` prints one self-check report as JSON and exits instead of starting the MCP server. */
export const SELF_CHECK_FLAG = "--doctor";
/**
 * `server.js --request-permissions <kinds>` shows macOS's permission dialogs for the helper and prints what is
 * granted afterwards as JSON. Kinds, comma-separated: accessibility, screen-recording, input-monitoring,
 * automation:<bundle id>, and
 * automation-status:<bundle id>, which only reads.
 */
export const PERMISSION_REQUEST_FLAG = "--request-permissions";
