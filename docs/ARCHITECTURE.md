# Engine and review architecture

## Data flow

`Uint8Array source → strict SMF parser → validated tick recipe → per-clip state
reconstruction → deterministic type0 encoder → ZIP + source-bound recipe + ledger`

`src/midi.mjs` owns the bounded binary parser, state machine, recipe boundary
resolution and output encoder. `src/export.mjs` owns SHA-256, bounded ledger encoding
and uncompressed ZIP framing with CRC32. `web/app.mjs` manages the user-visible
workflow. `scripts/clip.mjs` exposes the same engine for independent testing.

## Deterministic event order

Source events are ordered by absolute tick, source track, then source event order.
A channel may only occur in one track, so cross-track channel-state order is never
silently guessed. Same-tick tempo or meter events from distinct tracks reject.
The recipe is resolved to integer ticks before any clip is emitted.

Each clip emits at tick0: tempo, meter, per-channel program/controllers, then any
retriggered active notes. Pedal-held released notes emit on then off while the
restored sustain is active. Source events in [start,end) follow in original order.
State origins are retained in the ledger: restored settings point to their last
source tick; an empty source tick means a documented default, not hidden source data.
End closure emits held-key offs then sustain release per channel, followed by EOT.
Source note-off velocities are retained; only synthetic offs use zero.

The state machine separately tracks whether a sounding key is physically down.
Releasing a key while sustain is on marks it released but retains its sounding
state. Sustain release removes those released voices. The strict importer rejects
same-pitch re-attacks while the prior voice is still sounding, rather than guessing
voice allocation. It is deliberately stricter than the full MIDI format.

## Interruption and stale-result controls

Every source/recipe edit invalidates results synchronously and increments a revision.
Async file reads and fingerprint/build promises check the captured revision before
committing results. Reset clears source/recipe/UI controls. Later completion of an
older import cannot restore it. Exports are only enabled for a current reviewed bundle.
Language changes re-render labels without changing source or recipe values.

## Independence of the checks

The main engine and JS tests are one layer. `tests/oracle.py` uses Mido to write
independent inputs and compares output against handwritten expected event lists;
it does not import engine functions to derive expectations. The browser suite imports
that independent input and sends its actual downloaded ZIP to the Mido verifier.
The native test feeds exported MIDI into FluidSynth's native MIDI-file player and
file renderer, observing emitted note events and PCM activity/quiet windows.
No application oscillator or playback model is used as the native oracle.

All unsupported features fail before an export. No partial ZIP is emitted after a
validation error. Metadata stays byte-exact in copied MIDI; ledger metadata detail
is bounded to type and byte count to prevent expansion-based memory amplification.

## Event-budget bound

Before per-clip encoding, the sum of in-range source events plus a conservative
synthetic bound must be at most500,000. Per clip the bound is
`3 + channelCount × (6 + 256 + 128 + 1)`: two global settings and EOT, six channel
settings, at most128 sustained notes with an entry on/off pair, at most128 ending
key releases and one ending sustain release. With16 channels this is6259. The
upper bound covers omitted boundary ledger records too, without imposing a fixed
8192-event penalty that would unnecessarily reject64 silent clips.
