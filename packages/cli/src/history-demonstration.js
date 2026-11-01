// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// This source-only bridge keeps `node --experimental-strip-types src/cli.ts` runnable;
// package builds emit `dist/history-demonstration.js` directly from `history-demonstration.ts`.
export * from "./history-demonstration.ts";
