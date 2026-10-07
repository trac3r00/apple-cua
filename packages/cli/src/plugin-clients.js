// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// This source-only bridge keeps `node --experimental-strip-types src/cli.ts` runnable;
// package builds emit `dist/plugin-clients.js` directly from `plugin-clients.ts`.
export * from "./plugin-clients.ts";
