// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// This source-only bridge keeps `node --experimental-strip-types src/cli.ts` runnable;
// package builds emit `dist/lifecycle-commands.js` directly from `lifecycle-commands.ts`.
export * from "./lifecycle-commands.ts";
