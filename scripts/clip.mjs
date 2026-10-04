import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { buildBundle } from "../src/export.mjs";
const [input, recipe, out] = process.argv.slice(2);
if (!input || !recipe || !out) {
  console.error(
    "Usage: node scripts/clip.mjs INPUT.mid RECIPE.json OUTPUT_DIR",
  );
  process.exit(2);
}
try {
  const bytes = new Uint8Array(await readFile(input)),
    raw = JSON.parse(await readFile(recipe, "utf8"));
  const b = await buildBundle(bytes, raw, basename(input));
  await mkdir(join(out, "clips"), { recursive: true });
  for (const [name, data] of b.entries) await writeFile(join(out, name), data);
  await writeFile(join(out, "bundle.zip"), b.zip);
  console.log(
    JSON.stringify({
      clips: b.results.length,
      sourceSha256: b.recipe.sourceSha256,
      results: b.results.map((r) => ({
        name: r.clip.name,
        ticks: r.ticks,
        seconds: r.seconds,
      })),
    }),
  );
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
