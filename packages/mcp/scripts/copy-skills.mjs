import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../../skills/opencua/", import.meta.url));
const target = fileURLToPath(new URL("../skills/opencua/", import.meta.url));
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
