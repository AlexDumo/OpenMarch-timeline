// cspell:words meshoptimizer meshoptimizer's ndarray premultiplying SCEN tris khronos meshopt webp
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const [desktop, dir] = process.argv.slice(2);
const require = createRequire(path.join(desktop, "package.json"));
const { NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
const { getBounds } = require("@gltf-transform/functions");
const { validateBytes } = await import(require.resolve("gltf-validator").replace("index.js", "module.mjs"));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith("-r0.glb")).sort()) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  const rep = await validateBytes(bytes, { maxIssues: 0, writeTimestamp: false });
  const doc = await io.readBinary(bytes);
  const { min, max } = getBounds(doc.getRoot().getDefaultScene());
  const r = (v) => v.toFixed(3);
  const tex = [...new Set(doc.getRoot().listTextures().map((t) => `${t.getMimeType().slice(6)} ${t.getSize().join("x")}`))];
  console.log(f.padEnd(44), (bytes.length / 1e6).toFixed(2) + "MB", `errors=${rep.issues.numErrors} warn=${rep.issues.numWarnings}`, `tris=${rep.info.totalTriangleCount}`, `minY=${r(min[1])} cx=${r((min[0] + max[0]) / 2)} cz=${r((min[2] + max[2]) / 2)} size=${[0, 1, 2].map((i) => r(max[i] - min[i])).join("x")}`, tex.join(","));
}
