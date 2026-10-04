import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMidi,
  validateRecipe,
  excerpt,
  encodeMidi,
} from "../src/midi.mjs";
import { buildBundle, fingerprint } from "../src/export.mjs";
import { demoBytes, demoRecipe } from "../src/example.mjs";
const m = () => parseMidi(demoBytes());
test("canonical excerpt duration, sustained retrigger order and ending", () => {
  const r = excerpt(m(), demoRecipe().clips[0]);
  assert.equal(r.ticks, 720);
  assert.equal(r.seconds, 0.75);
  const notes = r.events.filter((e) => e.note === 60);
  assert.deepEqual(
    notes.map((e) => [e.tick, e.type, e.velocity]),
    [
      [0, "noteOn", 80],
      [0, "noteOff", 0],
    ],
  );
  assert.ok(
    r.events.findIndex(
      (e) => e.type === "cc" && e.controller === 64 && e.value === 127,
    ) < r.events.indexOf(notes[0]),
  );
  assert.deepEqual(
    r.events
      .slice(-2)
      .map((e) => [
        e.tick,
        e.type,
        e.note ?? e.controller,
        e.value ?? e.velocity,
      ]),
    [
      [720, "noteOff", 67, 0],
      [720, "cc", 64, 0],
    ],
  );
  assert.equal(parseMidi(r.bytes).duration, 720);
});
test("onsets omits sustained entry but retains silence and new notes", () => {
  const r = excerpt(m(), demoRecipe().clips[1]);
  assert.equal(
    r.events.some((e) => e.note === 60),
    false,
  );
  assert.equal(r.events.find((e) => e.type === "noteOn").tick, 120);
  assert.equal(r.seconds, 0.75);
});
test("marker recipe resolves exactly and duplicate names rejected", () => {
  assert.equal(
    validateRecipe(
      {
        version: 1,
        clips: [
          {
            name: "a",
            startMarker: "Rehearsal",
            endMarker: "End",
            entryPolicy: "retrigger",
          },
        ],
      },
      m(),
    ).clips[0].startTick,
    480,
  );
  assert.throws(
    () =>
      validateRecipe(
        {
          version: 1,
          clips: [
            demoRecipe().clips[0],
            { ...demoRecipe().clips[0], name: "RETRIGGER" },
          ],
        },
        m(),
      ),
    /DUPLICATE_NAME/,
  );
});
test("64 clips allowed, 65 rejected", async () => {
  const clips = Array.from({ length: 64 }, (_, i) => ({
    ...demoRecipe().clips[0],
    name: "c" + i,
  }));
  assert.equal(
    (await buildBundle(demoBytes(), { version: 1, clips })).results.length,
    64,
  );
  clips.push({ ...clips[0], name: "last" });
  await assert.rejects(
    buildBundle(demoBytes(), { version: 1, clips }),
    /CLIP_COUNT/,
  );
});
test("bundle deterministic, source-bound recipe, and no source leak", async () => {
  const a = await buildBundle(demoBytes(), demoRecipe(), "example.mid");
  const b = await buildBundle(demoBytes(), a.recipe, "example.mid");
  assert.deepEqual(a.zip, b.zip);
  assert.equal(a.recipe.sourceSha256, await fingerprint(demoBytes()));
  assert.equal(a.entries.length, 5);
  assert.equal(
    a.entries.some(([name]) => name === "example.mid"),
    false,
  );
  await assert.rejects(
    buildBundle(demoBytes(), { ...demoRecipe(), sourceSha256: "x" }),
    /SOURCE_MISMATCH/,
  );
});
test("all supported controllers persist into entry; channels preserved", () => {
  const bytes = encodeMidi(
    96,
    [
      { tick: 0, type: "program", channel: 7, value: 23 },
      ...[1, 7, 10, 11, 64].map((controller) => ({
        tick: 0,
        type: "cc",
        channel: 7,
        controller,
        value: 77,
      })),
    ],
    192,
  );
  const x = excerpt(parseMidi(bytes), {
    name: "silent",
    startTick: 96,
    endTick: 192,
    entryPolicy: "onsets",
  });
  assert.deepEqual(
    x.events
      .filter((e) => e.type === "cc")
      .map((e) => [e.channel, e.controller, e.value]),
    [
      [7, 1, 77],
      [7, 7, 77],
      [7, 10, 77],
      [7, 11, 77],
      [7, 64, 77],
      [7, 64, 0],
    ],
  );
  assert.equal(x.ticks, 96);
});
test("metadata ledger stays bounded while MIDI retains full text", () => {
  const data = Array(8192).fill(42),
    bytes = encodeMidi(480, [{ tick: 0, type: "meta", meta: 1, data }], 960);
  const x = excerpt(parseMidi(bytes), {
    name: "text",
    startTick: 0,
    endTick: 960,
    entryPolicy: "onsets",
  });
  assert.equal(
    x.ledger.find((e) => e.type === "meta").detail,
    "meta 1; 8192 bytes",
  );
  assert.equal(
    parseMidi(x.bytes).events.find((e) => e.type === "meta").data.length,
    8192,
  );
});
test("every unlisted controller rejects, including RPN, NRPN, MPE and pedals", () => {
  for (let cc = 0; cc < 128; cc++) {
    const bytes = encodeMidi(
      480,
      [{ tick: 0, type: "cc", channel: 0, controller: cc, value: 0 }],
      480,
    );
    if ([1, 7, 10, 11, 64].includes(cc))
      assert.doesNotThrow(() => parseMidi(bytes));
    else
      assert.throws(
        () => parseMidi(bytes),
        /CONTROLLER_UNSUPPORTED/,
        `CC${cc}`,
      );
  }
});
test("copied note-off release velocity is preserved; synthetic end-off uses zero", () => {
  const bytes = encodeMidi(
    480,
    [
      { tick: 0, type: "noteOn", channel: 0, note: 60, velocity: 80 },
      { tick: 100, type: "noteOff", channel: 0, note: 60, velocity: 47 },
      { tick: 150, type: "noteOn", channel: 0, note: 61, velocity: 81 },
    ],
    480,
  );
  const x = excerpt(parseMidi(bytes), {
    name: "a",
    startTick: 0,
    endTick: 240,
    entryPolicy: "onsets",
  });
  assert.deepEqual(
    parseMidi(x.bytes)
      .events.filter((e) => e.type === "noteOff")
      .map((e) => e.velocity),
    [47, 0],
  );
});
test("type1 rejects multi-track channel ownership", () => {
  const first = encodeMidi(
    480,
    [{ tick: 0, type: "program", channel: 0, value: 1 }],
    480,
  );
  const second = encodeMidi(
    480,
    [{ tick: 0, type: "cc", channel: 0, controller: 7, value: 90 }],
    480,
  );
  const both = new Uint8Array([...first, ...second.slice(14)]);
  both[9] = 1;
  both[11] = 2;
  assert.throws(() => parseMidi(both), /CHANNEL_OWNERSHIP/);
});
test("same-tick globals in different tracks reject ambiguity", () => {
  const first = encodeMidi(
      480,
      [{ tick: 0, type: "tempo", value: 500000 }],
      480,
    ),
    second = encodeMidi(480, [{ tick: 0, type: "tempo", value: 600000 }], 480),
    both = new Uint8Array([...first, ...second.slice(14)]);
  both[9] = 1;
  both[11] = 2;
  assert.throws(() => parseMidi(both), /AMBIGUOUS_GLOBAL_STATE/);
});
test("valid running-status notes parse and normalize velocity-zero", () => {
  const data = [0, 144, 60, 80, 120, 60, 0, 0, 255, 47, 0];
  const bytes = new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    1,
    224,
    77,
    84,
    114,
    107,
    0,
    0,
    0,
    data.length,
    ...data,
  ]);
  assert.deepEqual(
    parseMidi(bytes).events.map((e) => e.type),
    ["noteOn", "noteOff"],
  );
});
test("restoration ledger traces source ticks, defaults remain source-less", () => {
  const r = excerpt(m(), demoRecipe().clips[0]);
  assert.equal(r.ledger.find((e) => e.type === "program").sourceTick, 0);
  assert.equal(r.ledger.find((e) => e.detail === "CC64=127").sourceTick, 240);
  assert.equal(
    r.ledger.find((e) => e.reason === "release retriggered key under sustain")
      .sourceTick,
    360,
  );
  assert.equal(r.ledger.find((e) => e.detail === "CC1=0").sourceTick, "");
});
test("Windows reserved device basenames reject regardless of case or MIDI extension", () => {
  const reserved = [
    "CON",
    "PRN",
    "AUX",
    "NUL",
    ...Array.from({ length: 9 }, (_, i) => "COM" + (i + 1)),
    ...Array.from({ length: 9 }, (_, i) => "LPT" + (i + 1)),
  ];
  for (const name of reserved)
    for (const casing of [
      name,
      name.toLowerCase(),
      name[0] + name.slice(1).toLowerCase(),
    ])
      assert.throws(
        () =>
          validateRecipe(
            { version: 1, clips: [{ ...demoRecipe().clips[0], name: casing }] },
            m(),
          ),
        /RESERVED_CLIP_NAME/,
        casing + ".mid",
      );
  for (const name of ["CONCERT", "com0", "COM10", "LPT10", "aux-melody"])
    assert.doesNotThrow(() =>
      validateRecipe(
        { version: 1, clips: [{ ...demoRecipe().clips[0], name }] },
        m(),
      ),
    );
});
test("dense sustained-entry batch cannot exceed the declared event budget", async () => {
  const events = [];
  for (let channel = 0; channel < 16; channel++) {
    for (let note = 0; note < 128; note++)
      events.push({ tick: 0, type: "noteOn", channel, note, velocity: 80 });
    events.push({ tick: 120, type: "cc", channel, controller: 64, value: 127 });
    for (let note = 0; note < 128; note++)
      events.push({ tick: 240, type: "noteOff", channel, note, velocity: 0 });
    events.push({ tick: 600, type: "cc", channel, controller: 64, value: 0 });
    for (let note = 0; note < 128; note++)
      events.push({ tick: 720, type: "noteOn", channel, note, velocity: 90 });
  }
  events.sort((a, b) => a.tick - b.tick);
  const bytes = encodeMidi(480, events, 1440),
    parsed = parseMidi(bytes),
    clip = {
      name: "dense",
      startTick: 480,
      endTick: 1200,
      entryPolicy: "retrigger",
    },
    one = excerpt(parsed, clip);
  assert.equal(one.events.length + 1, 8323);
  assert.equal(
    one.ledger.filter((e) => e.classification === "synthetic").length,
    6259,
  );
  assert.equal(
    one.ledger.filter((e) => e.classification === "original").length,
    2064,
  );
  await assert.rejects(
    buildBundle(bytes, {
      version: 1,
      clips: Array.from({ length: 63 }, (_, i) => ({
        ...clip,
        name: "dense-" + i,
      })),
    }),
    /BATCH_EVENT_LIMIT/,
  );
});
test("64 silent clips across all16channels stay within the conservative budget", async () => {
  const bytes = encodeMidi(
    480,
    Array.from({ length: 16 }, (_, channel) => ({
      tick: 0,
      type: "program",
      channel,
      value: 0,
    })),
    960,
  );
  const bundle = await buildBundle(bytes, {
    version: 1,
    clips: Array.from({ length: 64 }, (_, i) => ({
      name: "silent-" + i,
      startTick: 480,
      endTick: 960,
      entryPolicy: "onsets",
    })),
  });
  assert.equal(bundle.results.length, 64);
  assert.equal(
    bundle.results.every(
      (r) => r.ticks === 480 && !r.events.some((e) => e.type === "noteOn"),
    ),
    true,
  );
});
