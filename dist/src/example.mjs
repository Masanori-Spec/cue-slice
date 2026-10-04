import { encodeMidi } from "./midi.mjs";
const e = (tick, type, extra = {}) => ({ tick, type, channel: 0, ...extra });
export const demoBytes = () =>
  encodeMidi(
    480,
    [
      e(0, "tempo", { value: 500000 }),
      e(0, "timeSignature", { data: [4, 2, 24, 8] }),
      e(0, "program", { value: 40 }),
      e(0, "cc", { controller: 7, value: 90 }),
      e(0, "cc", { controller: 10, value: 32 }),
      e(120, "noteOn", { note: 60, velocity: 80 }),
      e(240, "cc", { controller: 64, value: 127 }),
      e(360, "noteOff", { note: 60, velocity: 0 }),
      e(480, "meta", {
        meta: 6,
        data: [...new TextEncoder().encode("Rehearsal")],
      }),
      e(600, "noteOn", { note: 64, velocity: 90 }),
      e(720, "noteOff", { note: 64, velocity: 0 }),
      e(840, "cc", { controller: 64, value: 0 }),
      e(960, "noteOn", { note: 67, velocity: 100 }),
      e(1200, "meta", { meta: 6, data: [...new TextEncoder().encode("End")] }),
      e(1440, "noteOff", { note: 67, velocity: 0 }),
    ],
    1920,
  );
export const demoRecipe = () => ({
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
});
