# Cua Cursor Motion

`cua-cursor-motion.js` is the dependency-free planner from
[`@trycua/cursor-motion` 0.1.0](https://github.com/trycua/cua/tree/a7524cfd1d3e959963b43954d43f27c4bd260f08/libs/typescript/cursor-motion),
pinned at `a7524cfd1d3e959963b43954d43f27c4bd260f08`.
Copyright (c) 2025 Cua AI, Inc.; distributed under the adjacent MIT `LICENSE`.
Upstream explicitly recommends vendoring because the package is not published.

The entry point is upstream `src/plan.ts`. It was bundled with Bun 1.4.2:
`Bun.build({ entrypoints: ["/cua-motion/plan.ts"], files, target: "browser",
format: "esm", minify: false })`. `files` maps that pinned source directory's
TypeScript files to `/cua-motion/<name>.ts`; relative imports receive explicit
`.ts` suffixes for Bun's in-memory resolver. Biome formats the resulting module.
The planner algorithms are unchanged. No canvas renderer or runtime dependency
is included. The adjacent declaration describes the subset apple-cua consumes.

To update, repeat that bundle from a reviewed upstream commit and replay the
upstream golden trajectories plus apple-cua's motion transport tests. Do not
hand-edit the generated planner. Its generated JavaScript is excluded from
repository linting; apple-cua's configuration, adapter, and tests are not.
