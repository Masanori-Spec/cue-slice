// Adversarial hand-authored byte probes; complements the independent Mido oracle.
import test from "node:test";
import assert from "node:assert/strict";
import { parseMidi, validateRecipe, excerpt, LIMITS } from "../src/midi.mjs";
import { buildBundle } from "../src/export.mjs";
const u16 = (x) => [(x >> 8) & 255, x & 255],
  u32 = (x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255];
const smf = (t, { format = 0, ppq = 480 } = {}) =>
  new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    ...u16(format),
    0,
    1,
    ...u16(ppq),
    77,
    84,
    114,
    107,
    ...u32(t.length),
    ...t,
  ]);
const vlq = (v) => {
  const a = [v & 127];
  while ((v >>= 7)) a.unshift((v & 127) | 128);
  return a;
};
const end = [0, 255, 47, 0],
  good = smf([0, 144, 60, 80, 120, 128, 60, 0, ...end]);
const reject = (name, fn, expected) =>
  test(`strict rejection: ${name}`, () => {
    assert.throws(fn, (error) => {
      assert.ok(error.code, `Expected a coded MIDI error, got ${error}`);
      if (expected) assert.equal(error.code, expected);
      return true;
    });
  });
for (let n = 0; n < good.length; n++)
  reject(`truncated@${n}`, () => parseMidi(good.slice(0, n)));
reject(
  "trailing bytes",
  () => parseMidi(new Uint8Array([...good, 0])),
  "TRAILING_BYTES",
);
reject(
  "data status byte",
  () => parseMidi(smf([0, 144, 128, 80, ...end])),
  "DATA_BYTE",
);
reject("no EOT", () => parseMidi(smf([0, 144, 60, 80])), "MISSING_END");
reject(
  "after EOT",
  () => parseMidi(smf([...end, 0, 144, 60, 80])),
  "EVENT_AFTER_END",
);
reject(
  "bad EOT length",
  () => parseMidi(smf([0, 255, 47, 1, 0])),
  "END_LENGTH",
);
reject(
  "5-byte delta",
  () => parseMidi(smf([128, 128, 128, 128, 0, ...end])),
  "VLQ_TOO_LONG",
);
reject(
  "SMPTE",
  () => parseMidi(smf(end, { ppq: 0xe728 })),
  "TIMING_UNSUPPORTED",
);
reject("type2", () => parseMidi(smf(end, { format: 2 })), "FORMAT_UNSUPPORTED");
reject(
  "sysex",
  () => parseMidi(smf([0, 240, 0, ...end])),
  "SYSTEM_UNSUPPORTED",
);
reject(
  "pitch bend",
  () => parseMidi(smf([0, 224, 0, 64, ...end])),
  "MESSAGE_UNSUPPORTED",
);
reject(
  "bank select",
  () => parseMidi(smf([0, 176, 0, 0, ...end])),
  "CONTROLLER_UNSUPPORTED",
);
reject(
  "meta sequencer",
  () => parseMidi(smf([0, 255, 127, 0, ...end])),
  "META_UNSUPPORTED",
);
reject(
  "noteoff without onset",
  () => parseMidi(smf([0, 128, 60, 0, ...end])),
  "UNMATCHED_NOTE_OFF",
);
reject(
  "overlapping key",
  () => parseMidi(smf([0, 144, 60, 80, 10, 144, 60, 80, ...end])),
  "OVERLAPPING_PITCH",
);
reject(
  "overlapping sustained released",
  () =>
    parseMidi(
      smf([
        0,
        176,
        64,
        127,
        0,
        144,
        60,
        80,
        10,
        128,
        60,
        0,
        10,
        144,
        60,
        80,
        ...end,
      ]),
    ),
  "OVERLAPPING_PITCH",
);
reject(
  "too many bytes",
  () => parseMidi(new Uint8Array(LIMITS.bytes + 1)),
  "FILE_TOO_LARGE",
);
reject(
  "tick overflow",
  () => parseMidi(smf([...vlq(LIMITS.ticks), 255, 1, 0, 1, 255, 47, 0])),
  "TICK_LIMIT",
);
reject(
  "huge meta",
  () =>
    parseMidi(
      smf([0, 255, 1, ...vlq(8193), ...new Array(8193).fill(0), ...end]),
    ),
  "META_LENGTH_LIMIT",
);
const emptyEvents = [];
for (let i = 0; i < 100001; i++) emptyEvents.push(0, 255, 1, 0);
emptyEvents.push(...end);
reject("event cap", () => parseMidi(smf(emptyEvents)), "EVENT_LIMIT");
const m = parseMidi(good),
  spec = {
    version: 1,
    clips: [
      { name: "a", startTick: 0, endTick: 120, entryPolicy: "retrigger" },
    ],
  };
for (const [name, change, code] of [
  ["beyond end", { endTick: 121 }, "BOUNDARY_RANGE"],
  ["empty range", { endTick: 0 }, "BOUNDARY_RANGE"],
  ["negative", { startTick: -1 }, "BOUNDARY_RANGE"],
  ["fraction", { startTick: 0.5 }, "BOUNDARY_RANGE"],
  ["NaN", { endTick: NaN }, "BOUNDARY_RANGE"],
  ["traversal", { name: "../a" }, "CLIP_NAME"],
  ["case name empty", { name: "" }, "CLIP_NAME"],
  ["policy", { entryPolicy: "magic" }, "ENTRY_POLICY"],
])
  reject(
    name,
    () =>
      validateRecipe({ ...spec, clips: [{ ...spec.clips[0], ...change }] }, m),
    code,
  );
reject(
  "casefold duplicate",
  () =>
    validateRecipe(
      { ...spec, clips: [spec.clips[0], { ...spec.clips[0], name: "A" }] },
      m,
    ),
  "DUPLICATE_NAME",
);
reject(
  "clip cap",
  () =>
    validateRecipe({ ...spec, clips: new Array(65).fill(spec.clips[0]) }, m),
  "CLIP_COUNT",
);
const malformedTrack = good.slice();
malformedTrack[21]--;
reject("short declared track", () => parseMidi(malformedTrack));
test("source-end held keys close at exact EOT without extension", () => {
  const dangling = parseMidi(smf([0, 144, 61, 80, 120, 255, 47, 0]));
  const x = excerpt(dangling, {
    name: "close",
    startTick: 0,
    endTick: 120,
    entryPolicy: "retrigger",
  });
  assert.equal(x.events.at(-2).type, "noteOff");
  assert.equal(x.events.at(-2).tick, 120);
  assert.equal(x.events.at(-1).controller, 64);
  assert.equal(x.ticks, 120);
});

test("source-end note-off is replaced by explicit half-open synthetic closure", async () => {
  const b = await buildBundle(good, spec);
  assert.equal(b.results[0].ticks, 120);
  const notes = b.results[0].events.filter(
    (e) => e.type === "noteOn" || e.type === "noteOff",
  );
  assert.deepEqual(
    notes.map((e) => [e.tick, e.type, e.note, e.velocity]),
    [
      [0, "noteOn", 60, 80],
      [120, "noteOff", 60, 0],
    ],
  );
});

test("exported recipe source fingerprint mismatch rejects", async () => {
  await assert.rejects(
    buildBundle(good, { ...spec, sourceSha256: "a".repeat(64) }),
    (error) => error.code === "SOURCE_MISMATCH",
  );
});

test("large metadata stays intact in MIDI without multiplying into CSV detail", async () => {
  const track = [];
  for (let i = 0; i < 16; i++)
    track.push(0, 255, 1, ...vlq(8192), ...new Array(8192).fill(255));
  track.push(...vlq(480), 255, 47, 0);
  const source = smf(track);
  const bundle = await buildBundle(source, {
    version: 1,
    clips: Array.from({ length: 4 }, (_, i) => ({
      name: `meta-${i}`,
      startTick: 0,
      endTick: 480,
      entryPolicy: "onsets",
    })),
  });
  for (const result of bundle.results) {
    const meta = parseMidi(result.bytes).events.filter(
      (e) => e.type === "meta",
    );
    assert.equal(meta.length, 16);
    for (const event of meta) {
      assert.equal(event.meta, 1);
      assert.equal(event.data.length, 8192);
      assert.ok(event.data.every((value) => value === 255));
    }
    for (const record of result.ledger.filter((r) => r.type === "meta")) {
      assert.ok(
        record.detail.length <= 100,
        "Do not expand arbitrary metadata to decimal CSV strings",
      );
    }
  }
  const ledger = bundle.entries.find(
    ([name]) => name === "boundary-events.csv",
  )[1];
  assert.ok(new TextEncoder().encode(ledger).length < 16000);
  assert.ok(bundle.zip.length < 600000);
});

test("copied note-off release velocity survives while synthetic and velocity-zero offs use zero", () => {
  const source = parseMidi(
    smf([0, 144, 61, 80, 120, 128, 61, 99, 120, 255, 47, 0]),
  );
  const copied = excerpt(source, {
    name: "copy",
    startTick: 0,
    endTick: 240,
    entryPolicy: "retrigger",
  });
  assert.equal(copied.events.find((e) => e.type === "noteOff").velocity, 99);
  assert.equal(
    parseMidi(copied.bytes).events.find((e) => e.type === "noteOff").velocity,
    99,
  );
  const truncated = excerpt(source, {
    name: "truncate",
    startTick: 0,
    endTick: 100,
    entryPolicy: "retrigger",
  });
  assert.equal(truncated.events.find((e) => e.type === "noteOff").velocity, 0);
  const velocityZero = parseMidi(
    smf([0, 144, 61, 80, 120, 144, 61, 0, 120, 255, 47, 0]),
  );
  const normalized = excerpt(velocityZero, {
    name: "zero",
    startTick: 0,
    endTick: 240,
    entryPolicy: "onsets",
  });
  assert.equal(normalized.events.find((e) => e.type === "noteOff").velocity, 0);
  assert.equal(
    parseMidi(normalized.bytes).events.find((e) => e.type === "noteOff")
      .velocity,
    0,
  );
});
