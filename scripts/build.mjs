import { mkdir, rm, copyFile, readFile, writeFile } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/src", { recursive: true });
for (const f of ["midi.mjs", "export.mjs", "example.mjs"])
  await copyFile("src/" + f, "dist/src/" + f);
for (const f of ["index.html", "styles.css"])
  await copyFile("web/" + f, "dist/" + f);
await writeFile(
  "dist/app.mjs",
  (await readFile("web/app.mjs", "utf8")).replaceAll("../src/", "./src/"),
);
console.log("Built local-first static app with relative paths.");
