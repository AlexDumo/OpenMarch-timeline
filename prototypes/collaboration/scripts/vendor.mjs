// Copies sql.js (the browser mirror's SQLite) and the repo's demo shows into public/.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(import.meta.url);
const sqlDist = dirname(require.resolve("sql.js/dist/sql-wasm.js"));

mkdirSync(join(root, "public/vendor"), { recursive: true });
for (const f of ["sql-wasm.js", "sql-wasm.wasm"])
    copyFileSync(join(sqlDist, f), join(root, "public/vendor", f));

const demos = join(root, "../../apps/desktop/web/public/demos");
mkdirSync(join(root, "public/demos"), { recursive: true });
for (const f of ["part1-demo.dots", "lhb-daft-punk-pt2.dots"])
    if (existsSync(join(demos, f))) copyFileSync(join(demos, f), join(root, "public/demos", f));
console.log("vendored sql.js and demo shows into public/");
