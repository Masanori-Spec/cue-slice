# Verification status

Verified on **2026-10-04** against application commit
[`86017ea8b9f5bd22b5df23bbe17221aa88f5edc4`](https://github.com/Masanori-Spec/cue-slice/commit/86017ea8b9f5bd22b5df23bbe17221aa88f5edc4).
All four jobs passed in [GitHub Actions run 37199838010](https://github.com/Masanori-Spec/cue-slice/actions/runs/37199838010).
The evidence files below were copied from that run's downloaded artifacts and their
archive SHA-256 values checked against GitHub's artifact digests. These are
reproducible snapshots, not trusted inputs to the application.

## Passed in CI

- Node **22 and 24**: `npm ci --ignore-scripts`, build, **85 tests** on each version,
  module syntax, dist/source parity and local-asset/CSP checks
- Independent **Mido 1.3.3**: **11 literal cases** per engine job, full ordered event
  streams, release velocities, exact ticks/seconds, ZIP integrity and recipe replay
- Official Ubuntu 22.04 **FluidSynth 2.2.5** native player/file renderer: **5 cases**,
  exact note order and velocity, 15 ms timing tolerance, audible/silent windows,
  declared MIDI duration and bounded release-tail checks
- Chromium with **`chromiumSandbox: true`**: **17 scenarios**, Japanese/English,
  desktop/390 px mobile, keyboard, 64/65-clip boundary, failed/stale/delayed imports,
  Reset, repeated byte-identical exports, source-bound replay and actual downloads
- Actual browser-downloaded ZIP: **2 clips** checked independently by Mido and then
  consumed byte-for-byte by the official native FluidSynth file player
- Deliberately missing final note-off: detected by the native callback oracle in
  both native routes. Tail silence alone is insufficient because the consumer can
  release voices automatically at EOF
- Reviewed print capture and **two-page A4 PDF**: both result cards, 720-tick/
  0.750-second intervals, repeated table headers, full visible ledger and limits
- Browser reports: no runtime errors or off-origin requests

Canonical source interval is [480,1200), at 480 PPQ and 500000 microseconds per
quarter: 720 output ticks and 0.75 seconds. No application algorithm changed to
make the native tail test pass: the harness now renders a fixed three-second tail
after native player completion, with unchanged event/audio assertions.

## Evidence

- [CI summary and artifact digests](evidence/ci-summary.json)
- [Browser scenario report](evidence/ci-browser-results.json)
- [Actual-download Mido report](evidence/ci-download-oracle.json)
- [Actual-download native report](evidence/ci-browser-native-report.json)
- [Five-case native report](evidence/ci-native-consumer-report.json)
- [Eleven-case Mido report](evidence/ci-oracle-report.json)
- [English desktop](evidence/desktop-en-reviewed.png), [Japanese desktop](evidence/desktop-ja-empty.png)
- [Japanese mobile](evidence/mobile-ja-reviewed.png), [English mobile](evidence/mobile-en-reviewed.png)
- [Print screenshot](evidence/print-en-reviewed.png), [A4 PDF](evidence/print-en-reviewed.pdf)

All four screen screenshots, the print capture and both rendered PDF pages were
visually inspected. Text, controls and tables were legible without clipping or
overlap. The mobile captures and print layout passed horizontal overflow assertions.

## Local review and provenance

Independent local review also passed 85 Node tests, 11 Mido cases, five native
cases, two additional boundary/metadata probes and direct consumption of the CI
browser ZIP. It added Windows reserved-device filename rejection and the
channel-dependent conservative event budget. Local reports remain historical
snapshots: [check log](evidence/local-check.log), [Mido](evidence/oracle-report.json),
[native](evidence/native-consumer-report.json).

Local FluidSynth reports 2.4.4 but its installation origin is not established by
the local package database. **CI does establish official-package provenance**:
`libfluidsynth3=2.2.5-1` and `timgm6mb-soundfont=1.3-5`, installed from the runner's
Ubuntu repositories. The test-only font matches SHA-256
`c5378b62028c920cb11e4803327983fee2f2cdff5dc89c708e39da417e51c854`.
No SoundFont or third-party runtime is distributed with the application.

## Remaining limits

A pass proves these fixtures on this consumer/font, not waveform identity,
sound-engine independence or all-DAW interoperability. Retriggering restarts an
attack. Browser-screen-reader combinations, real phones, MIDI hardware,
Logic/Cakewalk import, commercial demand and user testing remain unverified.
The repository is public; no hosted application deployment is claimed.
