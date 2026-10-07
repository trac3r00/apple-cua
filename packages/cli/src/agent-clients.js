// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// This source-only bridge keeps `node --experimental-strip-types src/cli.ts` runnable;
// package builds emit `dist/agent-clients.js` directly from `agent-clients.ts`.
export * from "./agent-clients.ts";
