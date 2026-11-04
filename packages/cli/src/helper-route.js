// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// This source-only bridge keeps `node --experimental-strip-types src/cli.ts` runnable;
// package builds emit `dist/helper-route.js` directly from `helper-route.ts`.
export * from "./helper-route.ts";
