/** Strict, bounded SMF profile. No dependencies, playback or network access. */
export class MidiError extends Error {
  constructor(code, detail = "") {
    super(`${code}${detail ? ": " + detail : ""}`);
    this.code = code;
  }
}
const fail = (code, detail) => {
  throw new MidiError(code, detail);
};
export const CC = [1, 7, 10, 11, 64];
export const LIMITS = Object.freeze({
  bytes: 4 * 1024 * 1024,
  events: 100000,
  ticks: 0x0fffffff,
  tracks: 64,
  clips: 64,
});
const check = (x, c, d) => {
  if (!x) fail(c, d);
};
export function parseMidi(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  let p = 0;
  check(b.length <= LIMITS.bytes, "FILE_TOO_LARGE");
  const need = (n) => check(p + n <= b.length, "TRUNCATED", `byte ${p}`);
  const u8 = () => {
    need(1);
    return b[p++];
  };
  const u16 = () => u8() * 256 + u8();
  const u32 = () => u16() * 65536 + u16();
  const tag = () => String.fromCharCode(u8(), u8(), u8(), u8());
  check(tag() === "MThd", "HEADER");
  check(u32() === 6, "HEADER_LENGTH");
  const format = u16(),
    tracks = u16(),
    ppq = u16();
  check(format === 0 || format === 1, "FORMAT_UNSUPPORTED");
  check(
    tracks > 0 && tracks <= LIMITS.tracks && (format !== 0 || tracks === 1),
    "TRACK_COUNT",
  );
  check(!(ppq & 32768) && ppq > 0, "TIMING_UNSUPPORTED");
  const events = [],
    owners = new Map();
  let duration = 0,
    sequence = 0;
  for (let track = 0; track < tracks; track++) {
    check(tag() === "MTrk", "TRACK_HEADER");
    const length = u32(),
      end = p + length;
    check(end <= b.length, "TRUNCATED_TRACK");
    let tick = 0,
      running = 0,
      ended = false;
    const vlq = () => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        check(p < end, "TRUNCATED_VLQ");
        const x = u8();
        v = v * 128 + (x & 127);
        if (!(x & 128)) return v;
      }
      fail("VLQ_TOO_LONG");
    };
    while (p < end) {
      check(!ended, "EVENT_AFTER_END");
      tick += vlq();
      check(tick <= LIMITS.ticks, "TICK_LIMIT");
      let s = u8();
      if (s < 128) {
        check(running, "RUNNING_STATUS");
        p--;
        s = running;
      }
      const e = { tick, track, sequence: sequence++ };
      check(sequence <= LIMITS.events, "EVENT_LIMIT");
      if (s === 255) {
        running = 0;
        const meta = u8(),
          len = vlq();
        check(p + len <= end, "TRUNCATED_META");
        check(len <= 8192, "META_LENGTH_LIMIT");
        const data = [...b.slice(p, p + len)];
        p += len;
        if (meta === 47) {
          check(len === 0, "END_LENGTH");
          ended = true;
          duration = Math.max(duration, tick);
          continue;
        }
        if (meta === 81) {
          check(len === 3, "TEMPO_LENGTH");
          e.type = "tempo";
          e.value = data[0] * 65536 + data[1] * 256 + data[2];
          check(e.value > 0, "TEMPO_ZERO");
        } else if (meta === 88) {
          check(
            len === 4 &&
              data[0] > 0 &&
              data[1] <= 7 &&
              data[2] > 0 &&
              data[3] > 0,
            "TIME_SIGNATURE",
          );
          e.type = "timeSignature";
          e.data = data;
        } else if (meta >= 1 && meta <= 9) {
          e.type = "meta";
          e.meta = meta;
          e.data = data;
          if (meta === 6)
            e.marker = new TextDecoder("utf-8", { fatal: false }).decode(
              new Uint8Array(data),
            );
        } else fail("META_UNSUPPORTED", `0x${meta.toString(16)} at ${tick}`);
      } else {
        check(
          s >= 128 && s < 240,
          "SYSTEM_UNSUPPORTED",
          `status 0x${s.toString(16)}`,
        );
        running = s;
        const hi = s >> 4;
        e.channel = s & 15;
        check(
          [8, 9, 11, 12].includes(hi),
          "MESSAGE_UNSUPPORTED",
          `status 0x${s.toString(16)}`,
        );
        const data = () => {
          check(p < end, "TRUNCATED_EVENT");
          const x = u8();
          check(x < 128, "DATA_BYTE");
          return x;
        };
        const a = data();
        const d = hi === 12 ? null : data();
        if (hi === 8 || hi === 9) {
          e.type = hi === 8 || d === 0 ? "noteOff" : "noteOn";
          e.note = a;
          e.velocity = hi === 8 ? d : e.type === "noteOff" ? 0 : d;
          e.velocityZero = hi === 9 && d === 0;
        }
        if (hi === 11) {
          check(CC.includes(a), "CONTROLLER_UNSUPPORTED", `CC${a} at ${tick}`);
          e.type = "cc";
          e.controller = a;
          e.value = d;
        }
        if (hi === 12) {
          e.type = "program";
          e.value = a;
        }
        check(
          !owners.has(e.channel) || owners.get(e.channel) === track,
          "CHANNEL_OWNERSHIP",
          `channel ${e.channel + 1}`,
        );
        owners.set(e.channel, track);
      }
      events.push(e);
    }
    check(ended, "MISSING_END");
    check(p === end, "TRACK_LENGTH");
  }
  check(p === b.length, "TRAILING_BYTES");
  events.sort(
    (a, b) => a.tick - b.tick || a.track - b.track || a.sequence - b.sequence,
  );
  const global = new Map();
  for (const e of events) {
    if (e.type === "tempo" || e.type === "timeSignature") {
      const key = `${e.tick}:${e.type}`;
      check(
        !global.has(key) || global.get(key) === e.track,
        "AMBIGUOUS_GLOBAL_STATE",
      );
      global.set(key, e.track);
    }
  }
  const state = makeState();
  for (const e of events) apply(state, e, true);
  return {
    format,
    ppq,
    tracks,
    duration,
    events,
    channels: [...owners.keys()].sort((a, b) => a - b),
    markers: events
      .filter((e) => e.marker !== undefined)
      .map((e) => ({ tick: e.tick, name: e.marker })),
  };
}
export function makeState() {
  return {
    tempo: 500000,
    timeSignature: [4, 2, 24, 8],
    tempoOrigin: "",
    timeSignatureOrigin: "",
    channels: new Map(),
  };
}
export function channelState(s, c) {
  if (!s.channels.has(c))
    s.channels.set(c, {
      program: 0,
      origins: new Map(),
      cc: new Map([
        [1, 0],
        [7, 100],
        [10, 64],
        [11, 127],
        [64, 0],
      ]),
      notes: new Map(),
    });
  return s.channels.get(c);
}
export function apply(s, e, strict = false) {
  if (e.type === "tempo") {
    s.tempo = e.value;
    s.tempoOrigin = e.tick;
  }
  if (e.type === "timeSignature") {
    s.timeSignature = [...e.data];
    s.timeSignatureOrigin = e.tick;
  }
  if (e.channel === undefined) return;
  const c = channelState(s, e.channel);
  if (e.type === "program") {
    c.program = e.value;
    c.origins.set("program", e.tick);
  }
  if (e.type === "cc") {
    c.cc.set(e.controller, e.value);
    c.origins.set(e.controller, e.tick);
    if (e.controller === 64 && e.value < 64)
      for (const [n, v] of c.notes) if (!v.down) c.notes.delete(n);
  }
  if (e.type === "noteOn") {
    if (strict)
      check(
        !c.notes.has(e.note),
        "OVERLAPPING_PITCH",
        `channel ${e.channel + 1}, pitch ${e.note}, tick ${e.tick}`,
      );
    c.notes.set(e.note, { down: true, velocity: e.velocity, tick: e.tick });
  }
  if (e.type === "noteOff") {
    const n = c.notes.get(e.note);
    if (strict)
      check(
        n && n.down,
        "UNMATCHED_NOTE_OFF",
        `channel ${e.channel + 1}, pitch ${e.note}, tick ${e.tick}`,
      );
    if (n) {
      n.down = false;
      n.releaseTick = e.tick;
      if (c.cc.get(64) < 64) c.notes.delete(e.note);
    }
  }
}
export function encodeMidi(ppq, events, duration) {
  const vlq = (v) => {
    check(Number.isInteger(v) && v >= 0 && v <= LIMITS.ticks, "ENCODE_DELTA");
    let a = [v & 127];
    while ((v >>= 7)) a.unshift((v & 127) | 128);
    return a;
  };
  const data = [];
  let last = 0;
  for (const e of events) {
    data.push(...vlq(e.tick - last));
    last = e.tick;
    if (e.type === "tempo")
      data.push(
        255,
        81,
        3,
        (e.value >> 16) & 255,
        (e.value >> 8) & 255,
        e.value & 255,
      );
    else if (e.type === "timeSignature") data.push(255, 88, 4, ...e.data);
    else if (e.type === "meta")
      data.push(255, e.meta, ...vlq(e.data.length), ...e.data);
    else if (e.type === "program") data.push(192 | e.channel, e.value);
    else if (e.type === "cc") data.push(176 | e.channel, e.controller, e.value);
    else
      data.push(
        (e.type === "noteOn" ? 144 : 128) | e.channel,
        e.note,
        e.velocity ?? 0,
      );
  }
  data.push(...vlq(duration - last), 255, 47, 0);
  const n = data.length;
  return new Uint8Array([
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
    ppq >> 8,
    ppq & 255,
    77,
    84,
    114,
    107,
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
    ...data,
  ]);
}
export function validateRecipe(raw, midi) {
  check(raw && raw.version === 1 && Array.isArray(raw.clips), "RECIPE_SCHEMA");
  check(raw.clips.length > 0 && raw.clips.length <= LIMITS.clips, "CLIP_COUNT");
  const names = new Set();
  return {
    version: 1,
    clips: raw.clips.map((c) => {
      check(
        c &&
          typeof c.name === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(c.name),
        "CLIP_NAME",
      );
      check(
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(c.name),
        "RESERVED_CLIP_NAME",
      );
      check(!names.has(c.name.toLowerCase()), "DUPLICATE_NAME");
      names.add(c.name.toLowerCase());
      check(
        c.entryPolicy === "retrigger" || c.entryPolicy === "onsets",
        "ENTRY_POLICY",
      );
      const resolve = (key) => {
        const mk = c[key + "Marker"];
        if (mk !== undefined) {
          check(
            typeof mk === "string" && c[key + "Tick"] === undefined,
            "BOUNDARY_SCHEMA",
          );
          const list = midi.markers.filter((m) => m.name === mk);
          check(list.length === 1, "MARKER_AMBIGUOUS", mk);
          return list[0].tick;
        }
        return c[key + "Tick"];
      };
      const startTick = resolve("start"),
        endTick = resolve("end");
      check(
        Number.isSafeInteger(startTick) &&
          Number.isSafeInteger(endTick) &&
          startTick >= 0 &&
          endTick > startTick &&
          endTick <= midi.duration,
        "BOUNDARY_RANGE",
      );
      return { name: c.name, startTick, endTick, entryPolicy: c.entryPolicy };
    }),
  };
}
export function excerpt(midi, clip) {
  const { startTick: start, endTick: end, entryPolicy } = clip;
  const state = makeState();
  for (const e of midi.events) {
    if (e.tick >= start) break;
    apply(state, e);
  }
  const out = [],
    ledger = [];
  const emit = (e, sourceTick, classification, reason) => {
    out.push(e);
    ledger.push({
      clip: clip.name,
      sourceTick,
      destinationTick: e.tick,
      channel: e.channel === undefined ? "" : e.channel + 1,
      type: e.type,
      detail:
        e.type === "cc"
          ? `CC${e.controller}=${e.value}`
          : e.type === "noteOn" || e.type === "noteOff"
            ? `${e.note}:${e.velocity ?? 0}`
            : (e.value ??
              (e.type === "meta"
                ? `meta ${e.meta}; ${e.data.length} bytes`
                : (e.data?.join(" ") ?? ""))),
      classification,
      reason,
    });
  };
  emit(
    { tick: 0, type: "tempo", value: state.tempo },
    state.tempoOrigin,
    "synthetic",
    "entry tempo",
  );
  emit(
    { tick: 0, type: "timeSignature", data: state.timeSignature },
    state.timeSignatureOrigin,
    "synthetic",
    "entry time signature",
  );
  const channels = midi.channels;
  const live = makeState();
  for (const ch of channels) {
    const c = channelState(state, ch);
    const setup = [
      { type: "program", value: c.program },
      ...CC.map((controller) => ({
        type: "cc",
        controller,
        value: c.cc.get(controller),
      })),
    ];
    for (const e of setup) {
      const o = { tick: 0, channel: ch, ...e };
      emit(
        o,
        c.origins.get(e.type === "program" ? "program" : e.controller) ?? "",
        "synthetic",
        "entry state",
      );
      apply(live, o);
    }
  }
  for (const ch of channels) {
    const c = channelState(state, ch);
    for (const [note, n] of c.notes) {
      if (entryPolicy === "retrigger") {
        const on = {
          tick: 0,
          type: "noteOn",
          channel: ch,
          note,
          velocity: n.velocity,
        };
        emit(
          on,
          n.tick,
          "synthetic",
          n.down ? "retrigger held key" : "retrigger sustained released key",
        );
        apply(live, on);
        if (!n.down) {
          const off = {
            tick: 0,
            type: "noteOff",
            channel: ch,
            note,
            velocity: 0,
          };
          emit(
            off,
            n.releaseTick ?? start,
            "synthetic",
            "release retriggered key under sustain",
          );
          apply(live, off);
        }
      } else
        ledger.push({
          clip: clip.name,
          sourceTick: n.tick,
          destinationTick: 0,
          channel: ch + 1,
          type: "noteOn",
          detail: `${note}:${n.velocity}`,
          classification: "omitted",
          reason: "new onsets only: pre-boundary note",
        });
    }
  }
  for (const e of midi.events) {
    if (e.tick < start) continue;
    if (e.tick >= end) break;
    if (
      e.type === "noteOff" &&
      !channelState(live, e.channel).notes.get(e.note)?.down
    ) {
      ledger.push({
        clip: clip.name,
        sourceTick: e.tick,
        destinationTick: e.tick - start,
        channel: e.channel + 1,
        type: e.type,
        detail: `${e.note}:${e.velocity}`,
        classification: "omitted",
        reason: "paired onset was before excerpt",
      });
      continue;
    }
    const o = { ...e, tick: e.tick - start };
    emit(
      o,
      e.tick,
      "original",
      e.velocityZero
        ? "velocity-zero note-on normalized as note-off"
        : "copied within [start,end)",
    );
    apply(live, o);
  }
  const length = end - start;
  for (const ch of channels) {
    for (const [note, n] of channelState(live, ch).notes)
      if (n.down)
        emit(
          { tick: length, type: "noteOff", channel: ch, note, velocity: 0 },
          end,
          "synthetic",
          "truncate key at end",
        );
    emit(
      { tick: length, type: "cc", channel: ch, controller: 64, value: 0 },
      end,
      "synthetic",
      "release sustain at end",
    );
  }
  ledger.push({
    clip: clip.name,
    sourceTick: end,
    destinationTick: length,
    channel: "",
    type: "endOfTrack",
    detail: length,
    classification: "synthetic",
    reason: "retain exact declared duration",
  });
  let tempo = 500000,
    last = 0,
    seconds = 0;
  for (const e of out)
    if (e.type === "tempo") {
      seconds += ((e.tick - last) * tempo) / (midi.ppq * 1e6);
      tempo = e.value;
      last = e.tick;
    }
  seconds += ((length - last) * tempo) / (midi.ppq * 1e6);
  return {
    clip,
    events: out,
    ledger,
    ticks: length,
    seconds,
    bytes: encodeMidi(midi.ppq, out, length),
  };
}
