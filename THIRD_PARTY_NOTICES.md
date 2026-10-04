# Third-party test components

The shipped static application has no third-party runtime libraries, fonts or assets.
The score motif is CSS geometry; all demonstration note data is authored for this tool.

Development/testing only:

- Playwright 1.56.0 / @playwright/test 1.56.0 — Microsoft, Apache-2.0; installed by npm,
  not copied into the static site or source archive
- Mido 1.3.3 — Mido contributors, MIT; independent Python MIDI parser/writer
- packaging 25.0 — Python Packaging Authority, Apache-2.0 or BSD-2-Clause
- FluidSynth — native MIDI renderer, LGPL-2.1-or-later; used only as an installed test
  consumer. The native library is not redistributed with CueSlice
- TimGM6mb.sf2 — Tim Brechbill / David Bolton, GPL-2; existing local file and official
  Ubuntu test package. SHA-256 c5378b62028c920cb11e4803327983fee2f2cdff5dc89c708e39da417e51c854.
  The SoundFont is not redistributed. Its package copyright is available at
  /usr/share/doc/timgm6mb-soundfont/copyright on a standard installed environment

See docs/NATIVE_CONSUMER.md for provenance limits and upstream links. These notices
describe test dependencies; they do not select a license for the CueSlice project.
