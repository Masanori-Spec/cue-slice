import { parseMidi } from "../src/midi.mjs";
import { buildBundle } from "../src/export.mjs";
import { demoBytes, demoRecipe } from "../src/example.mjs";
const $ = (id) => document.getElementById(id);
let lang = "ja",
  source = null,
  midi = null,
  recipe = { version: 1, clips: [] },
  bundle = null,
  revision = 0;
const en = {
  skip: "Skip to editor",
  language: "Language",
  eyebrow: "THE PART YOU NEED. THE CONTEXT IT NEEDS.",
  headline: "Cut the passage.<br>Keep the context.",
  intro:
    "Turn one MIDI performance into a ready-to-share rehearsal set. Restore its entry state and leave a clear record of every boundary decision.",
  demo: "Try the example ↗",
  privacy: "Local processing · No upload",
  profileTitle: "A deliberate MIDI profile",
  profileText:
    "SMF 0 / 1 · PPQ · Notes · Program · CC1 / 7 / 10 / 11 / 64 · Tempo / meter",
  profileLink: "See the boundaries ↓",
  sourceTitle: "Your source performance",
  reset: "Reset",
  openMidi: "Choose MIDI",
  noSource: "No file loaded",
  sourceHint:
    "Up to 4 MB · 100,000 events · 64 tracks. Files stay on this device.",
  recipeTitle: "The excerpt recipe",
  importRecipe: "Import recipe",
  add: "+ Clip",
  recipeHint:
    "Start tick is included; end tick is excluded. Markers resolve to integer ticks. Up to 64 clips.",
  empty: "Load a MIDI file or try the example to begin.",
  policyNote:
    "“Retrigger active notes” restarts the attack of notes already sounding. It cannot reproduce their original waveform or effects state. “New onsets only” omits notes that began before the excerpt.",
  review: "Review boundaries",
  initialStatus: "Start by choosing a source MIDI.",
  resultsTitle: "Review the cut. Then hand it over.",
  download: "Download ZIP ↓",
  resultHint:
    "ZIP: MIDI clips / reusable recipe / complete boundary-event CSV / recipient guide. The source MIDI is not included.",
  ledgerTitle: "Preview the boundary receipt",
  ledgerHint:
    "First 100 synthetic and omitted events. The ZIP contains the complete ledger.",
  clip: "Clip",
  event: "Event",
  decision: "Decision",
  limitsTitle: "A handoff tool.<br>Not a sound-engine replica.",
  limitsText:
    "Only SMF 0/1 with PPQ timing. Rejects SysEx, pitch bend, pressure, other CC (including bank, RPN/NRPN, MPE setup, sostenuto and portamento), overlapping sounding same-channel/pitch notes and channels owned by multiple tracks.",
  endNote:
    "Keys and sustain are released at the end. MIDI duration is exact; a sound engine’s release tail may continue afterward. No audio player, recorder or automatic musical-section inference.",
  textNote:
    "Text and markers inside the range are retained. Earlier text is not copied; supply any required attribution separately. You are responsible for permission to use the source MIDI.",
  footer: "Small passages. Clear handoffs.",
};
const ja = {};
document
  .querySelectorAll("[data-i]")
  .forEach((e) => (ja[e.dataset.i] = e.innerHTML));
const t = (a, b) => (lang === "ja" ? a : b);
function status(a, b) {
  $("status").textContent = t(a, b);
}
function error(e) {
  $("error").hidden = false;
  $("error").textContent =
    t(
      "処理できませんでした。対応範囲と入力値を確認してください: ",
      "Could not process this input. Check the supported profile and values: ",
    ) + e.message;
}
function invalidate() {
  revision++;
  bundle = null;
  $("results").hidden = true;
  $("download").disabled = true;
  $("error").hidden = true;
  $("review").disabled = !source || !recipe.clips.length;
  status(
    "入力が変わりました。境界を再確認してください。",
    "Inputs changed. Review the boundaries again.",
  );
}
function reset() {
  invalidate();
  source = null;
  midi = null;
  recipe = { version: 1, clips: [] };
  $("midi-file").value = "";
  $("recipe-file").value = "";
  $("source-name").textContent = t(
    "まだファイルがありません",
    "No file loaded",
  );
  $("source-summary").replaceChildren();
  $("review").disabled = true;
  $("add").disabled = true;
  renderRows();
  status(
    "まずは元の MIDI を選んでください。",
    "Start by choosing a source MIDI.",
  );
}
function summary() {
  if (!midi) return;
  $("source-name").textContent = source.name;
  $("source-summary").replaceChildren();
  for (const s of [
    `SMF ${midi.format}`,
    `${midi.ppq} PPQ`,
    `${midi.duration} ticks`,
    `${midi.events.length} ${t("イベント", "events")}`,
    `${midi.markers.length} ${t("マーカー", "markers")}`,
  ]) {
    const el = document.createElement("span");
    el.textContent = s;
    $("source-summary").append(el);
  }
}
function setSource(bytes, name, initial) {
  const parsed = parseMidi(bytes);
  source = { bytes, name };
  midi = parsed;
  recipe = initial ?? {
    version: 1,
    clips: [
      {
        name: "excerpt-01",
        startTick: 0,
        endTick: Math.max(1, parsed.duration),
        entryPolicy: "retrigger",
      },
    ],
  };
  invalidate();
  summary();
  renderRows();
  $("add").disabled = false;
  status(
    "読み込みました。範囲と開始時の方針を選んでください。",
    "Source loaded. Choose the ranges and entry policies.",
  );
}
function inputField(row, label, key, value, index, type = "text") {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const lab = document.createElement("label");
  lab.htmlFor = `${key}-${index}`;
  lab.textContent = label;
  const input = document.createElement("input");
  input.id = lab.htmlFor;
  input.type = type;
  input.value = value;
  if (type === "number") {
    input.min = key === "endTick" ? "1" : "0";
    input.step = "1";
    input.max = midi.duration;
  } else input.maxLength = 48;
  input.dataset.field = key;
  input.addEventListener("input", () => {
    recipe.clips[index][key] =
      type === "number"
        ? input.value === ""
          ? null
          : Number(input.value)
        : input.value;
    invalidate();
  });
  wrap.append(lab, input);
  row.append(wrap);
  return wrap;
}
function renderRows() {
  const root = $("rows");
  root.replaceChildren();
  if (!recipe.clips.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t(
      "MIDI を読み込むか、サンプルを試してください。",
      "Load a MIDI file or try the example to begin.",
    );
    root.append(p);
    return;
  }
  recipe.clips.forEach((c, index) => {
    const row = document.createElement("div");
    row.className = "clip-row";
    const num = document.createElement("span");
    num.className = "clip-no";
    num.textContent = String(index + 1).padStart(2, "0");
    row.append(num);
    inputField(
      row,
      t("ファイル名（英数字）", "Filename (ASCII)"),
      "name",
      c.name,
      index,
    );
    for (const [key, label] of [
      ["startTick", t("開始 tick", "Start tick")],
      ["endTick", t("終了 tick", "End tick")],
    ]) {
      const f = inputField(row, label, key, c[key], index, "number");
      if (midi.markers.length) {
        const select = document.createElement("select");
        select.className = "marker-select";
        select.setAttribute(
          "aria-label",
          `${label} ${t("マーカー", "marker")} ${index + 1}`,
        );
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = t("マーカーから選ぶ", "Use a marker");
        select.append(placeholder);
        for (const m of midi.markers) {
          const option = document.createElement("option");
          option.value = String(m.tick);
          option.textContent = `${m.name} · ${m.tick}`;
          select.append(option);
        }
        select.addEventListener("change", () => {
          if (select.value !== "") {
            c[key] = Number(select.value);
            f.querySelector("input").value = c[key];
            invalidate();
          }
        });
        f.append(select);
      }
    }
    const policy = document.createElement("div");
    policy.className = "field";
    const label = document.createElement("label");
    label.htmlFor = `policy-${index}`;
    label.textContent = t("開始時の方針", "Entry policy");
    const select = document.createElement("select");
    select.id = label.htmlFor;
    select.dataset.field = "entryPolicy";
    for (const [value, text] of [
      ["retrigger", t("鳴っている音を再発音", "Retrigger active notes")],
      ["onsets", t("新しい発音のみ", "New onsets only")],
    ]) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      select.append(o);
    }
    select.value = c.entryPolicy;
    select.addEventListener("change", () => {
      c.entryPolicy = select.value;
      invalidate();
    });
    policy.append(label, select);
    row.append(policy);
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "×";
    remove.setAttribute(
      "aria-label",
      t(`クリップ ${index + 1} を削除`, `Remove clip ${index + 1}`),
    );
    remove.addEventListener("click", () => {
      recipe.clips.splice(index, 1);
      invalidate();
      renderRows();
      $("add").focus();
    });
    row.append(remove);
    root.append(row);
  });
  $("add").disabled = !source || recipe.clips.length >= 64;
}
function renderResults() {
  if (!bundle) return;
  const cards = $("result-cards");
  cards.replaceChildren();
  for (const r of bundle.results) {
    const card = document.createElement("article");
    card.className = "result-card";
    const h = document.createElement("h3");
    h.textContent = r.clip.name + ".mid";
    const metric = document.createElement("div");
    metric.className = "metric";
    metric.textContent = r.ticks;
    const small = document.createElement("small");
    small.textContent = `ticks · ${r.seconds.toFixed(3)} s`;
    metric.append(small);
    const p = document.createElement("p");
    p.textContent = `${r.clip.startTick} → ${r.clip.endTick} · ${r.clip.entryPolicy === "retrigger" ? t("再発音", "retrigger") : t("新しい発音のみ", "new onsets")}`;
    const counts = document.createElement("p");
    counts.className = "counts";
    counts.textContent = `${r.ledger.filter((x) => x.classification === "synthetic").length} ${t("合成", "synthetic")} / ${r.ledger.filter((x) => x.classification === "omitted").length} ${t("省略", "omitted")}`;
    card.append(h, metric, p, counts);
    cards.append(card);
  }
  const body = $("ledger");
  body.replaceChildren();
  for (const r of bundle.results
    .flatMap((x) => x.ledger)
    .filter((x) => x.classification !== "original")
    .slice(0, 100)) {
    const tr = document.createElement("tr");
    for (const value of [
      r.clip,
      r.destinationTick,
      r.channel,
      `${r.type} ${r.detail}`,
      `${r.classification}: ${r.reason}`,
    ]) {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.append(td);
    }
    body.append(tr);
  }
  $("results").hidden = false;
  $("download").disabled = false;
}
$("language").addEventListener("change", () => {
  lang = $("language").value;
  document.documentElement.lang = lang;
  document
    .querySelectorAll("[data-i]")
    .forEach((el) => (el.innerHTML = (lang === "en" ? en : ja)[el.dataset.i]));
  summary();
  renderRows();
  renderResults();
  if (bundle)
    status(
      "確認できました。記録を見てから ZIP を保存してください。",
      "Ready for review. Check the receipt, then save the ZIP.",
    );
  else if (source)
    status(
      "範囲を選び、境界を確認してください。",
      "Choose ranges and review boundaries.",
    );
});
$("demo").addEventListener("click", () => {
  reset();
  setSource(demoBytes(), "cue-slice-demo.mid", demoRecipe());
  $("workspace").focus();
});
$("reset").addEventListener("click", () => {
  reset();
  $("midi-file").focus();
});
$("midi-file").addEventListener("change", async (event) => {
  const f = event.target.files[0];
  if (!f) return;
  reset();
  const ticket = revision;
  try {
    if (f.size > 4 * 1024 * 1024) throw Error("FILE_TOO_LARGE");
    const b = new Uint8Array(await f.arrayBuffer());
    if (ticket !== revision) return;
    setSource(b, f.name);
  } catch (e) {
    if (ticket === revision) error(e);
  }
});
$("recipe-file").addEventListener("change", async (event) => {
  const f = event.target.files[0];
  if (!f) return;
  invalidate();
  const ticket = revision;
  try {
    if (!source) throw Error("LOAD_MIDI_FIRST");
    if (f.size > 262144) throw Error("RECIPE_TOO_LARGE");
    const raw = JSON.parse(await f.text());
    if (ticket !== revision) return;
    const checked = await buildBundle(source.bytes, raw, source.name);
    if (ticket !== revision) return;
    recipe = { ...checked.recipe };
    invalidate();
    renderRows();
    status(
      "レシピを読み込みました。境界を確認してください。",
      "Recipe imported. Review the boundaries.",
    );
  } catch (e) {
    if (ticket === revision) error(e);
  } finally {
    event.target.value = "";
  }
});
$("add").addEventListener("click", () => {
  if (!source || recipe.clips.length >= 64) return;
  let n = 1;
  while (
    recipe.clips.some((c) => c.name === `excerpt-${String(n).padStart(2, "0")}`)
  )
    n++;
  recipe.clips.push({
    name: `excerpt-${String(n).padStart(2, "0")}`,
    startTick: 0,
    endTick: midi.duration,
    entryPolicy: "retrigger",
  });
  invalidate();
  renderRows();
  $(`name-${recipe.clips.length - 1}`).focus();
});
$("review").addEventListener("click", async () => {
  if (!source) return;
  invalidate();
  const ticket = revision;
  $("review").disabled = true;
  status("境界を確認中…", "Reviewing boundaries…");
  try {
    const result = await buildBundle(source.bytes, recipe, source.name);
    if (ticket !== revision) return;
    bundle = result;
    renderResults();
    status(
      "確認できました。記録を見てから ZIP を保存してください。",
      "Ready for review. Check the receipt, then save the ZIP.",
    );
  } catch (e) {
    if (ticket === revision) error(e);
  } finally {
    if (ticket === revision) $("review").disabled = false;
  }
});
$("download").addEventListener("click", () => {
  if (!bundle) return;
  const url = URL.createObjectURL(
    new Blob([bundle.zip], { type: "application/zip" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "cue-slice-handoff.zip";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  status(
    "ZIP のダウンロードを開始しました。同じ内容を再度保存できます。",
    "ZIP download started. You can download the same bundle again.",
  );
});
