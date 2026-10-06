// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// This source-only bridge keeps `node --experimental-strip-types src/cli.ts` runnable;
// package builds emit `dist/doctor-fix.js` directly from `doctor-fix.ts`.
export * from "./doctor-fix.ts";
