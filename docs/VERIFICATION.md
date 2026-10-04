# Verification status

Build handoff snapshot: **2026-10-04**. This file describes local execution before
publication. It must not be interpreted as a successful GitHub Actions run.

## Passed locally

- `npm run check`: **85 tests passed**, zero failures/skips; build, module syntax,
  exact dist/source parity and local-asset/CSP checks passed
- Independent Mido 1.3.3 oracle: **11 literal export cases passed**. Each checks the
  ordered full MIDI stream, exact ticks/seconds, ZIP integrity and recipe replay
- Native FluidSynth 2.4.4 MIDI player/file renderer: **5 cases passed** with pinned
  TimGM6mb.sf2, including note timing, audible/silent windows and quiet tails
- Node v24.19.0, Python 3.12.14
- Canonical interval480→1200 at480PPQ/500000µs per quarter:720ticks,0.75seconds
- Copied original note-off release velocities preserved; synthetic offs use zero
- `npm ci --ignore-scripts` completed against committed package-lock.json
- Review hardening: Windows device basenames reject case-insensitively; the dense
  16-channel sustained-entry fixture proves the6259-event synthetic bound, rejects
  an over-budget63-clip batch, and still accepts64 silent clips across16 channels

Full local reports: [unit/check output](evidence/local-check.log),
[Mido report](evidence/oracle-report.json),
[native-consumer report](evidence/native-consumer-report.json).
The reports are snapshots. Tests and independent input generators are included so
that a reviewer can reproduce them; they are not trusted inputs to the app.

## Authored, not yet run

- GitHub Actions matrix: Node22 and24 engine + Mido
- Official Ubuntu22 package native consumer, providing package-provenance evidence
- Sandboxed Chromium browser suite:16 scenarios, including actual downloaded ZIP
  verified independently by Mido, JA/EN desktop/mobile, keyboard use, source-bound
  recipe replay,64/65clip boundaries, failed/stale/delayed imports and Reset
- Direct actual browser ZIP → native FluidSynth:2 artifact clips, source ZIP/per-MIDI
  hashes, native callback timing and audio checks. The equivalent CLI-ZIP control
  passed locally; it is not actual browser artifact evidence
- Screenshots and visual review of rendered UI
- Verification of exact published commit, remote tree, deployment URL and final CI

No local browser launch was attempted for this build because sandboxed local browser
execution is a known unavailable gate in this environment. The test script explicitly
uses `chromiumSandbox: true`; it does not retry with sandbox disabled.

## Provenance and interpretation

The installed native library reports FluidSynth2.4.4 and was successfully called
through its real player/renderer API. The SoundFont SHA-256 matches the pinned value and bytes extracted read-only from
the official Ubuntu timgm6mb-soundfont1.3-5 package; see native-consumer notes.
The local dpkg database contains no package records for these installed resources;
therefore official-package installation origin is **not established locally**.
The checked-in CI installs from the runner's official Ubuntu repositories and records
package metadata. That gate remains unrun in this snapshot.

A pass proves these fixtures on this library/font only. The audio check does not
establish waveform identity, sound-engine independence or all-DAW interoperability.
Browser-screen-reader combinations, real phones, MIDI hardware, Logic/Cakewalk import,
commercial demand and user testing remain unverified. No publication was performed
as part of this local build handoff.
