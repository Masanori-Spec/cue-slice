import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
for (const dir of ["src", "web", "scripts"])
  for (const name of await readdir(dir))
    if (name.endsWith(".mjs"))
      execFileSync(process.execPath, ["--check", `${dir}/${name}`]);
const html = await readFile("dist/index.html", "utf8");
if (/https?:\/\//.test(html)) throw Error("Unexpected remote runtime resource");
if (!html.includes("connect-src 'none'"))
  throw Error("Missing no-network policy");
for (const p of ["src/midi.mjs", "src/export.mjs", "src/example.mjs"])
  if ((await readFile(p, "utf8")) !== (await readFile("dist/" + p, "utf8")))
    throw Error("Built source mismatch " + p);
console.log(
  "Syntax, exact dist-source parity, local assets and CSP checks passed.",
);
