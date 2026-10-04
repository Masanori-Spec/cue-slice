# Why this bounded workflow exists

Research checked 2026-10-04. This is a software portfolio prototype, not a patent
claim, comprehensive market survey or demonstrated business. No customer validation
has been performed. The main user hypothesis is an arranger or teacher preparing
several rehearsal excerpts from one exported performance for somebody else to use.

## Primary comparisons

1. **Logic Pro MIDI Chase** already addresses missing context when playback starts
   after note/controller events. CueSlice does not claim to invent chasing. Its
   difference is a small portable batch of standalone MIDI files plus a reviewable
   recipe and synthetic-event receipt, outside a DAW session.
   https://support.apple.com/en-ae/guide/logicpro/lgcp621f927c/10.7/mac/11.0
2. **Cakewalk MIDI clip splitting** already inserts chase state and can split
   underlying notes. Its legacy documentation establishes that boundary-state
   repair is existing DAW functionality. This is not a claim about current paid
   product packaging or a hands-on performance comparison.
   https://legacy.cakewalk.com/Documentation?help=Tools.24.html&language=3&product=Cakewalk
3. **pretty_midi** already provides programmable cropping. Its primary source is
   a useful baseline, not a reason to claim generic cropping is new. We did not
   execute a pinned comparative benchmark of pretty_midi, so do not claim superior
   accuracy, speed, coverage or exact differences in all crop edge cases.
   https://github.com/craffel/pretty-midi/blob/main/pretty_midi/pretty_midi.py
4. **hapax-arrange** already turns DAW MIDI into marker/pattern bundles and an import
   checklist for Squarp Hapax. Its README targets Hapax and documents conversion
   limitations. CueSlice's proposed distinction is device-independent SMF output,
   preserved supported tempo changes, explicit note-entry choices and an event-level
   receipt. The broad “MIDI bundles” concept is not new.
   https://github.com/MarcAstr0/hapax-arrange/

## Proposed value, not a proven moat

The combined workflow is: one source-bound recipe → up to64 tick/marker excerpts →
explicit retrigger/onsets choice → native MIDI batch + boundary ledger + recipient
guide. Local processing and JA/EN presentation are conveniences, not the substantive
differentiation. The supported profile is intentionally narrow and fail-closed.

MIDI.org describes why setup state affects playback and why MIDI is instructions,
not recorded sound: https://midi.org/about-midi-part-4midi-files
Controller meanings: https://midi.org/midi-1-0-control-change-messages
The output should never be marketed as waveform-equivalent, a universal MIDI
round-trip, or compatible with untested synths. A successful native consumer check
establishes only the documented fixtures on that version/soundfont combination.

## Evidence and next product question

The independent Mido oracle covers exact events and duration. Native FluidSynth
covers real consumption and acoustic activity/tail termination, not identical audio.
Browser CI covers real downloaded bytes rather than an in-app playback surrogate.

The unresolved product question is whether a visible boundary receipt materially
reduces handoff troubleshooting compared with a DAW's existing clip export. That
requires real user evaluation before any commercial demand claim.
