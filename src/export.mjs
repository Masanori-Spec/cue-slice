import { parseMidi, validateRecipe, excerpt, MidiError } from "./midi.mjs";
const enc = new TextEncoder();
export async function fingerprint(b) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function zip(entries) {
  const local = [],
    central = [];
  let offset = 0;
  const u16 = (n) => [n & 255, (n >>> 8) & 255],
    u32 = (n) => [...u16(n), ...u16(n >>> 16)];
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) {
      c ^= x;
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  for (const [name, input] of entries) {
    const n = enc.encode(name),
      b = typeof input === "string" ? enc.encode(input) : input,
      c = crc(b),
      size = b.length;
    const h = new Uint8Array([
      80,
      75,
      3,
      4,
      ...u16(20),
      ...u16(2048),
      0,
      0,
      0,
      0,
      33,
      0,
      ...u32(c),
      ...u32(size),
      ...u32(size),
      ...u16(n.length),
      0,
      0,
      ...n,
    ]);
    local.push(h, b);
    central.push(
      new Uint8Array([
        80,
        75,
        1,
        2,
        ...u16(20),
        ...u16(20),
        ...u16(2048),
        0,
        0,
        0,
        0,
        33,
        0,
        ...u32(c),
        ...u32(size),
        ...u32(size),
        ...u16(n.length),
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        ...u32(offset),
        ...n,
      ]),
    );
    offset += h.length + b.length;
  }
  const cs = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array([
    80,
    75,
    5,
    6,
    0,
    0,
    0,
    0,
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(cs),
    ...u32(offset),
    0,
    0,
  ]);
  const all = [...local, ...central, end],
    out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of all) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
const csvCell = (x) => '"' + String(x ?? "").replace(/"/g, '""') + '"';
export function ledgerCsv(rows) {
  const cols = [
    "clip",
    "sourceTick",
    "destinationTick",
    "channel",
    "type",
    "detail",
    "classification",
    "reason",
  ];
  return (
    cols.join(",") +
    "\r\n" +
    rows.map((r) => cols.map((k) => csvCell(r[k])).join(",")).join("\r\n") +
    "\r\n"
  );
}
export async function buildBundle(bytes, rawRecipe, sourceName = "source.mid") {
  const midi = parseMidi(bytes),
    recipe = validateRecipe(rawRecipe, midi),
    sha = await fingerprint(bytes);
  if (rawRecipe.sourceSha256 && rawRecipe.sourceSha256 !== sha)
    throw new MidiError("SOURCE_MISMATCH");
  // 2 global settings + EOT; per channel: 6 setup, <=256 entry
  // on/off events, <=128 end note-offs, and one final sustain release.
  // Includes the largest supported 16-channel/128-pitch sustained-entry case.
  const syntheticUpperBound = 3 + midi.channels.length * (6 + 256 + 128 + 1);
  const budget = recipe.clips.reduce(
    (n, c) =>
      n +
      midi.events.filter((e) => e.tick >= c.startTick && e.tick < c.endTick)
        .length +
      syntheticUpperBound,
    0,
  );
  if (budget > 500000) throw new MidiError("BATCH_EVENT_LIMIT");
  const results = [];
  let totalBytes = 0;
  for (const c of recipe.clips) {
    const r = excerpt(midi, c);
    totalBytes += r.bytes.length;
    if (totalBytes > 32 * 1024 * 1024) throw new MidiError("BATCH_BYTE_LIMIT");
    results.push(r);
  }
  const normalized = {
    ...recipe,
    sourceName,
    sourceSha256: sha,
    ppq: midi.ppq,
    boundary: "[startTick,endTick)",
    outputFormat: 0,
  };
  const guide = `CueSlice recipient guide / 受け取りガイド\n\nSource / 元ファイル: ${sourceName}\nSHA-256: ${sha}\nPPQ: ${midi.ppq}; output SMF type 0, original channel numbers.\n\nEvery clip uses [start,end): includes start, excludes source events at end. End-of-track equals the declared length, including silence. Entry state is restored from events strictly before start; events at start follow setup. Each original channel gets program and CC1/7/10/11/64 setup (defaults: 0; 0/100/64/127/0). Tempo defaults to 500000 microseconds/quarter, time signature to 4/4.\n\nretrigger: key-held notes restart. A released note held by sustain receives note-on THEN note-off after pedal setup. This restarts its attack; it cannot recreate the original decaying waveform, effects state, banks, or external synth state.\nonsets: notes beginning before the excerpt are omitted, together with their later note-offs.\nEnd: held keys receive note-offs, then every source channel receives sustain release. A synthesizer may have a release tail after MIDI duration. Exact duration is MIDI ticks, not a forced audio cutoff.\n\n対応: SMF 0/1、PPQ、ノート、プログラム、CC1/7/10/11/64、テンポ・拍子。開始以前の状態を復元し、開始点は含み、終了点は含みません。retrigger は発音をやり直すため元の波形とは一致しません。onsets は開始前の音を省略します。末尾で鍵盤とサステインを解放しますが、音源のリリース余韻は残る場合があります。\n\nRejected, never silently dropped: SMPTE/type2, SysEx, pitch bend, pressure, all other CC (bank, RPN/NRPN, MPE setup, sostenuto, portamento), overlapping sounding same-channel/pitch notes, unmatched note-offs, multi-track ownership of a channel, unsupported metadata and malformed files. MPE expressive messages are unsupported; an unmarked note-only stream cannot be identified as MPE.\nText/marker meta events inside each excerpt are retained. Earlier text/track names are not copied; full source attribution must be supplied separately when required. This tool does not grant rights to source music.\n\nClips:\n${results.map((r) => `${r.clip.name}: ${r.clip.startTick}→${r.clip.endTick}, ${r.clip.entryPolicy}, ${r.ticks} ticks, ${r.seconds.toFixed(6)} sec`).join("\n")}\n\nReview boundary-events.csv for copied, synthesized and omitted boundary decisions. Channel numbers in CSV are 1–16; programs and pitches are raw MIDI numbers. JSON recipe is bound to the source hash. No upload or audio playback is performed.\n`;
  const entries = [
    ...results.map((r) => [`clips/${r.clip.name}.mid`, r.bytes]),
    ["excerpt-recipe.json", JSON.stringify(normalized, null, 2) + "\n"],
    ["boundary-events.csv", ledgerCsv(results.flatMap((r) => r.ledger))],
    ["recipient-guide.txt", guide],
  ];
  if (
    entries.reduce(
      (n, [, v]) =>
        n + (typeof v === "string" ? enc.encode(v).length : v.length),
      0,
    ) >
    40 * 1024 * 1024
  )
    throw new MidiError("BUNDLE_SIZE_LIMIT");
  return { midi, recipe: normalized, results, entries, zip: zip(entries) };
}
