import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
const dir = "test-results/browser",
  base = process.env.BASE_URL ?? "http://127.0.0.1:4173/";
await mkdir(dir, { recursive: true });
const results = [],
  errors = [],
  requests = [];
let browser, page;
const python = process.env.PYTHON ?? "python3";
const runPython = (args) => {
  const r = spawnSync(python, args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
};
async function scenario(name, fn) {
  try {
    await fn();
    results.push({ name, status: "passed" });
  } catch (error) {
    results.push({ name, status: "failed", error: error.message });
    if (page)
      await page.screenshot({ path: dir + "/failure.png", fullPage: true });
    throw error;
  }
}
const review = async () => {
  await page.locator("#review").click();
  await page.locator("#results").waitFor({ state: "visible" });
};
const inputRecipe = async (value) => {
  await page.locator("#recipe-file").setInputFiles({
    name: "recipe.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await page
    .locator("#status")
    .filter({ hasText: /Recipe imported|レシピを読み込みました/ })
    .waitFor();
};
const canonical = {
  version: 1,
  clips: [
    {
      name: "retrigger",
      startTick: 480,
      endTick: 1200,
      entryPolicy: "retrigger",
    },
    { name: "onsets", startTick: 480, endTick: 1200, entryPolicy: "onsets" },
  ],
};
async function download(name) {
  const pending = page.waitForEvent("download");
  await page.locator("#download").click();
  const d = await pending;
  await d.saveAs(dir + "/" + name);
  return readFile(dir + "/" + name);
}
try {
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  await scenario(
    "Japanese initial state; keyboard skip link at deployment subpath",
    async () => {
      await page.goto(base);
      assert.equal(await page.locator("html").getAttribute("lang"), "ja");
      assert.equal(await page.locator("#review").isDisabled(), true);
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .locator(".skip")
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await page.keyboard.press("Enter");
      assert.equal(
        await page
          .locator("#workspace")
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await page.screenshot({
        path: dir + "/desktop-ja-empty.png",
        fullPage: true,
      });
    },
  );
  await scenario(
    "English example, marker selection and both entry policies",
    async () => {
      await page.locator("#language").selectOption("en");
      await page.locator("#demo").click();
      assert.equal(await page.locator(".clip-row").count(), 2);
      await page
        .locator('select[aria-label="Start tick marker 1"]')
        .selectOption("480");
      await page
        .locator('select[aria-label="End tick marker 1"]')
        .selectOption("1200");
      await review();
      assert.equal(await page.locator(".result-card").count(), 2);
      assert.match(
        await page.locator(".metric").first().textContent(),
        /720.*0.750/,
      );
      await page.screenshot({
        path: dir + "/desktop-en-reviewed.png",
        fullPage: true,
      });
    },
  );
  await scenario(
    "Editing range invalidates prior results immediately",
    async () => {
      await page.locator("#endTick-0").fill("1300");
      assert.equal(await page.locator("#results").isHidden(), true);
      assert.equal(await page.locator("#download").isDisabled(), true);
      await page.locator("#endTick-0").fill("1200");
      await review();
    },
  );
  await scenario(
    "Independent MIDI fixture import and batch recipe",
    async () => {
      await page
        .locator("#midi-file")
        .setInputFiles("test-results/oracle/fixtures/canonical-smf0.mid");
      await page
        .locator("#source-name")
        .filter({ hasText: "canonical-smf0.mid" })
        .waitFor();
      assert.equal(await page.locator("#results").isHidden(), true);
      await inputRecipe(canonical);
      await review();
    },
  );
  await scenario(
    "Actual downloaded ZIP passes independent literal Mido oracle",
    async () => {
      await download("downloaded.zip");
      runPython([
        "tests/oracle.py",
        "--verify-browser-bundle",
        dir + "/downloaded.zip",
      ]);
      await writeFile(
        dir + "/download-oracle.json",
        await readFile("test-results/oracle/browser-bundle-report.json"),
      );
    },
  );
  await scenario("Repeated exports are byte-identical", async () => {
    const a = await readFile(dir + "/downloaded.zip"),
      b = await download("repeated.zip");
    assert.deepEqual(a, b);
  });
  await scenario(
    "Exported source-bound recipe reimports without changing bytes",
    async () => {
      runPython([
        "-c",
        `import zipfile; z=zipfile.ZipFile('${dir}/downloaded.zip'); open('${dir}/exported-recipe.json','wb').write(z.read('excerpt-recipe.json'))`,
      ]);
      await page
        .locator("#recipe-file")
        .setInputFiles(dir + "/exported-recipe.json");
      await page
        .locator("#status")
        .filter({ hasText: "Recipe imported" })
        .waitFor();
      await review();
      assert.deepEqual(
        await download("replayed.zip"),
        await readFile(dir + "/downloaded.zip"),
      );
    },
  );
  await scenario(
    "Wrong-source recipe rejects and stale result stays hidden",
    async () => {
      await inputRecipe(canonical);
      await review();
      await page.locator("#recipe-file").setInputFiles({
        name: "wrong.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({ ...canonical, sourceSha256: "a".repeat(64) }),
        ),
      });
      await page
        .locator("#error")
        .filter({ hasText: "SOURCE_MISMATCH" })
        .waitFor();
      assert.equal(await page.locator("#results").isHidden(), true);
    },
  );
  await scenario(
    "Invalid and unsupported MIDI clears the previous source",
    async () => {
      await page.locator("#midi-file").setInputFiles({
        name: "bad.mid",
        mimeType: "audio/midi",
        buffer: Buffer.from("not-midi"),
      });
      await page.locator("#error").waitFor({ state: "visible" });
      assert.equal(await page.locator("#review").isDisabled(), true);
      assert.equal(await page.locator(".clip-row").count(), 0);
      assert.equal(await page.locator("#results").isHidden(), true);
    },
  );
  await scenario("Invalid recipe input cannot reuse prior result", async () => {
    await page.locator("#demo").click();
    await review();
    await page.locator("#recipe-file").setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{broken"),
    });
    await page.locator("#error").waitFor({ state: "visible" });
    assert.equal(await page.locator("#results").isHidden(), true);
    assert.equal(await page.locator("#download").isDisabled(), true);
  });
  await scenario(
    "Keyboard-only edit, add and remove; empty batch disables review",
    async () => {
      await page.locator("#demo").click();
      await page.locator("#name-0").focus();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("keyboard-clip");
      await page.locator("#add").focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator(".clip-row").count(), 3);
      while (await page.locator(".clip-row").count())
        await page.locator(".remove").first().click();
      assert.equal(await page.locator("#review").isDisabled(), true);
    },
  );
  await scenario("Exactly 64 clips import, 65 rejects", async () => {
    const clips = Array.from({ length: 64 }, (_, i) => ({
      ...canonical.clips[0],
      name: "clip-" + i,
    }));
    await inputRecipe({ version: 1, clips });
    assert.equal(await page.locator(".clip-row").count(), 64);
    assert.equal(await page.locator("#add").isDisabled(), true);
    await page.locator("#recipe-file").setInputFiles({
      name: "65.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          clips: [...clips, { ...clips[0], name: "last" }],
        }),
      ),
    });
    await page.locator("#error").filter({ hasText: "CLIP_COUNT" }).waitFor();
  });
  await scenario(
    "Reset during delayed import prevents stale completion",
    async () => {
      await page.evaluate(() => {
        const original = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = async function () {
          await new Promise((r) => setTimeout(r, 250));
          return original.call(this);
        };
      });
      await page
        .locator("#midi-file")
        .setInputFiles("test-results/oracle/fixtures/canonical-smf0.mid");
      await page.locator("#reset").click();
      await page.waitForTimeout(400);
      assert.equal(await page.locator(".clip-row").count(), 0);
      assert.equal(await page.locator("#review").isDisabled(), true);
    },
  );
  await scenario(
    "Japanese mobile 390px, reviewed state and no horizontal overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("#language").selectOption("ja");
      await page.locator("#demo").click();
      await review();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: dir + "/mobile-ja-reviewed.png",
        fullPage: true,
      });
      await page.locator("#language").selectOption("en");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: dir + "/mobile-en-reviewed.png",
        fullPage: true,
      });
    },
  );
  await scenario(
    "Reset clears files, recipes, evidence and export state",
    async () => {
      await page.locator("#reset").click();
      assert.equal(await page.locator(".clip-row").count(), 0);
      assert.equal(await page.locator("#download").isDisabled(), true);
      assert.equal(await page.locator("#results").isHidden(), true);
      assert.equal(await page.locator("#midi-file").inputValue(), "");
    },
  );
  await scenario("No runtime errors or off-origin requests", async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(
      requests.filter((u) => !u.startsWith(new URL(base).origin)),
      [],
    );
  });
} catch (error) {
  await writeFile(dir + "/failure.txt", error.stack ?? String(error));
  throw error;
} finally {
  await writeFile(
    dir + "/results.json",
    JSON.stringify(
      {
        status:
          results.length === 16 && results.every((x) => x.status === "passed")
            ? "passed"
            : "failed-or-blocked",
        sandbox: true,
        testsRun: results.length,
        results,
        errors,
        requests,
      },
      null,
      2,
    ),
  );
  await browser?.close();
}
