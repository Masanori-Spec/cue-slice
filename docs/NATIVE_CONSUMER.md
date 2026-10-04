# Independent MIDI and native-consumer checks

CueSlice has two complementary checks which consume exported files. Neither
imports the application's MIDI parser, crop model, or expected-value generator.
These checks are reproducible tests, not a claim of compatibility with every DAW.

## Run

Node.js 22+ and Python 3.10+ are required. The app has no Python runtime dependency.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --index-url https://pypi.org/simple -r tests/requirements.txt
.venv/bin/python tests/oracle.py
.venv/bin/python tests/native-consumer.py
node --test tests/adversarial.test.mjs
```

For the native test on the official Ubuntu 22.04 GitHub Actions runner, install
from the runner's official Ubuntu package repositories:

```sh
sudo apt-get update
sudo apt-get install --no-install-recommends libfluidsynth3 timgm6mb-soundfont
```

The native test fails if FluidSynth or the exact test SoundFont is unavailable.
It does not silently skip checks, download another asset, or use an app-generated
oscillator as a substitute. A mismatch requires reviewing the dependency rather
than accepting any hash automatically.

Default evidence locations:

- `test-results/oracle/oracle-report.json`
- `test-results/oracle/fixtures/`: the independently authored input files
- `test-results/oracle/<case>/`: exports, ZIPs and replay outputs
- `test-results/native/native-consumer-report.json`
- `test-results/native/*.wav`: native test renders

Both scripts support `--out PATH`; the native script additionally accepts
`--oracle PATH` and `--soundfont PATH`. `tests/oracle.py --fixtures-only` writes
fixtures without running the exporter and does not claim a test pass.

## Mido oracle

`tests/oracle.py` uses pinned Mido 1.3.3 to write hand-authored inputs, executes the
public Node CLI, and reads the resulting SMF with Mido. It compares the complete
ordered event stream against literal expected tick positions, types, channels,
notes, velocities, controller values, program values and metadata. It also checks
SMF type 0, one output track, PPQ 480, exact end-of-track placement and duration.

The eleven export cases cover:

- The same score encoded as SMF0 and SMF1
- A released key that is still sounding under sustain at the left boundary
- A key still physically held at the left boundary
- Both `retrigger` and `onsets` policies for these boundary conditions
- Forced key release at the right boundary
- An onset exactly at the inclusive start and an onset at the exclusive end
- A source velocity-zero note-on, normalized to note-off with velocity zero
- Original note-off release velocities 30, 20 and 99 retained when copied;
  synthesized boundary note-offs remain zero
- A tempo change within the excerpt and a non-default meter
- Metadata inside the range and excluded pre-range text
- Leading silence, trailing silence and an entirely silent clip
- ZIP CRC/integrity and byte identity between loose and archived files
- Replay of the actual exported recipe against the same source

For the canonical crop, source PPQ is 480 and tempo is 500000 microseconds per
quarter. The source interval 480–1200 becomes 720 ticks, exactly 0.75 seconds.
The retrigger case emits sustain=127 before a note-on/note-off pair at tick zero,
which restores the sustained note without incorrectly treating its key as held.
The onsets case omits that pair. The original note-off for pitch 64 keeps its
source release velocity 30; normalizing every note-off to zero would silently
lose supported MIDI data and is deliberately rejected by these expectations. A second crop at 1200–1680 distinguishes a held
key from the previously released-but-sustained key. The variable-tempo crop has
240 ticks at 400000 and 240 ticks at 1000000 microseconds per quarter, exactly
0.7 seconds.

## Verify the actual browser download

The decisive browser fixture is `test-results/oracle/fixtures/canonical-smf0.mid`,
created by Mido rather than the application's demo generator. Import that file in
the browser, export the two clips named `retrigger` and `onsets`, both covering
480–1200 with their respective policies, and save the downloaded ZIP.

```sh
.venv/bin/python tests/oracle.py --verify-browser-bundle test-results/browser/downloaded.zip
```

This mode validates the ZIP's exact file list and CRC, the original independent
fixture's SHA-256, the two recipe definitions, and both full MIDI event streams
against the literal oracle expectations. It writes
`test-results/oracle/browser-bundle-report.json`. The browser test must supply its
actual downloaded file; passing a CLI-produced control ZIP only self-tests this
verification path and does not establish browser-download coverage.

## Adversarial parser and export checks

`tests/adversarial.test.mjs` adds 69 named Node tests for every truncation point in
a hand-authored minimal SMF, malformed track/VLQ/EOT data, unsupported messages,
invalid recipes, source-end closure, source hashes and resource limits. A metadata
regression verifies that long text remains intact in the MIDI while the CSV uses
bounded descriptions rather than expanding every byte to decimal text. These
app-level checks complement the independent Mido and native readers.

## Native FluidSynth consumer

`tests/native-consumer.py` uses Python's standard-library `ctypes` to call the
installed native `libfluidsynth.so.3`. It hands the exported `.mid` filename to
FluidSynth's own MIDI-file player and renders through its native file renderer.
No CueSlice parser or synth is used; no manual note injection is used. A callback
observes the player-emitted MIDI events and forwards each unchanged to the synth.
No audio device is opened.

For five exports (sustained retrigger, onsets, variable tempo, padded silence and
all silence), the test verifies:

1. The native file player completes successfully
2. Native parser total ticks match the independently specified expected values
3. Native note messages and their order match literal expected events
4. Native dispatch time is within 15 ms of each expected musical time
5. The rendered stereo PCM WAV is 44100 Hz, 16-bit and contains the expected
   audible/silent entry windows
6. Sound decays to silence after the clipped end instead of leaving a stuck note

The render disables reverb and chorus, uses one synth CPU core, a gain of 0.2 and
64-frame blocks. Timing is sample-clock driven, without realtime sleeping. The
15-second safety limit prevents a broken player from hanging CI. The report records
the runtime FluidSynth version, package-query result, platform, SoundFont hash,
input MIDI hashes, native note observations and audio measurements. It deliberately
does not pin a WAV checksum, since native-library patch levels can change samples.

The initial local verification used FluidSynth 2.4.4. The container's package
database did not identify `libfluidsynth3` or `timgm6mb-soundfont`; that absence is
recorded in the report and is not presented as verified package provenance. The
installed local binary’s origin cannot be established from its runtime version or
API behavior; use the CI package installation for a recorded official-repository
installation. CI
installs from the official Ubuntu repositories and records actual package versions.

### Test-only SoundFont

- Filename: `TimGM6mb.sf2`
- Typical package path: `/usr/share/sounds/sf2/TimGM6mb.sf2`
- Required SHA-256: `c5378b62028c920cb11e4803327983fee2f2cdff5dc89c708e39da417e51c854`
- Local package copyright notice: `/usr/share/doc/timgm6mb-soundfont/copyright`
- The notice identifies Tim Brechbill and David Bolton and the GPL-2 license

The pinned SoundFont hash was also verified against the file extracted from the
Ubuntu archive's [timgm6mb-soundfont 1.3-5 package](https://ftp.ports.ubuntu.com/ubuntu-ports/pool/universe/t/timgm6mb-soundfont/timgm6mb-soundfont_1.3-5_all.deb).
The downloaded `.deb` SHA-256 was
`b70bc29b8f27adef8f92a2d9c1e26cee977b84c68110f0dd4326d97730a7c3ed`.
The package was extracted for this comparison, not installed or redistributed.
This verifies the SoundFont byte match; it does not establish the origin of the
preinstalled local FluidSynth shared library.

The SoundFont is a separately installed test dependency. It is not included in
this repository or any application bundle. These instructions do not add a license
to the project or authorize redistribution of the SoundFont.

## What these checks do not prove

A retriggered MIDI excerpt restarts an instrument's envelopes. It cannot reproduce
the original audio phase, exact pre-boundary release tails, plugin automation,
DAW routing, or proprietary instrument state. WAV checks demonstrate that a real
native consumer accepts and plays these fixtures, not bit-identical audio to the
uncut source. The suite does not claim a GUI import test in a commercial DAW, an
arbitrary SoundFont comparison, or support for formats/events rejected by the app.

## References

- [Mido MIDI-file API](https://mido.readthedocs.io/en/stable/files/midi.html)
- [FluidSynth fast file renderer](https://www.fluidsynth.org/api/FileRenderer.html)
- [FluidSynth MIDI-file player API](https://www.fluidsynth.org/api/group__midi__player.html)
- [FluidSynth sample-clock and reset settings](https://www.fluidsynth.org/api/settings_player.html)
- [Ubuntu Jammy timgm6mb-soundfont package](https://packages.ubuntu.com/jammy/timgm6mb-soundfont)

## Direct browser-download → native gate

After the browser suite has saved its actual `test-results/browser/downloaded.zip`,
CI invokes:

```sh
python tests/native-consumer.py --browser-bundle test-results/browser/downloaded.zip --out test-results/browser/native-download
```

The browser job installs `libfluidsynth3` and `timgm6mb-soundfont` from the official
Ubuntu repositories. This step does not alter Chromium's sandbox or the17 browser
scenarios. The separate regular native job still covers its original5 cases.

The direct artifact gate accepts only the bounded canonical two-clip handoff: at
most1MiB compressed and declared uncompressed content, exactly5 archive members,
and the independent Mido literal/source-hash/CRC preflight. It copies only the
fixed `clips/retrigger.mid` and `clips/onsets.mid` members byte-for-byte to generated
local paths, with no arbitrary path extraction. FluidSynth's native MIDI-file
player then parses those bytes itself. The same handwritten callback note order,
release velocity, event-time,720-tick duration, audible/silent entry and quiet-tail
checks run on the2 actual artifact clips.

The report records the source ZIP SHA-256 and each consumed MIDI SHA-256, plus the
native version, package versions and pinned SoundFont hash. It is stored alongside
WAV evidence inside the browser artifact directory. The consumer does not infer
that a file came from a browser merely from its path: the calling CI workflow
provides download provenance. An equivalent CLI-generated ZIP is only a control
for this test route and is not evidence of browser execution.

At authoring time, the new route passed a local equivalent canonical CLI ZIP
control. Actual browser-ZIP → native execution and its official-package CI run
remain pending; the local control must not be presented as that completed gate.

## Player completion and release-envelope completion

The initial Ubuntu2.2.5 CI run stopped the renderer at player status `DONE`; its
retrigger WAV was only0.753197 seconds for a0.75-second MIDI file, so the last
window still contained an active release tail. Local2.4.4 player completion had
already included additional rendering time. These are different lifecycle signals,
not evidence that the exported MIDI duration should change.

The consumer now renders a fixed3-second post-player tail using additional
`fluid_file_renderer_process_block` calls. It keeps `player.reset-synth=0`, sends
no extra note/controller events, and does not invoke all-sounds-off or erase audio.
The original note callback/timing checks and final RMS≤2 silence threshold remain
unchanged. Reports distinguish frames at player completion from post-player frames.
The tail is bounded, and the existing15-second active-player safety limit remains.

This follows the separate player/synth and renderer lifecycles documented by the
[official renderer API](https://www.fluidsynth.org/api/group__file__renderer.html)
and [player reset setting](https://www.fluidsynth.org/api/settings_player.html).
The actual first-run browser ZIP passes this revised consumer locally on2.4.4;
confirmation on the official Ubuntu2.2.5 CI runtime remains pending the rerun.


Some FluidSynth versions also release pending voices automatically at EOF.
Therefore a quiet tail alone is not proof that the MIDI contained a final note-off.
The exact native callback event/timing assertion remains mandatory. A separate
negative control removes the final pitch67 note-off while preserving all absolute
ticks, feeds that malformed handoff to the real native player and requires the
observed note-event stream to differ from the literal expected stream. Its result
is recorded as a detected negative control, separately from the5 (or2 artifact)
positive cases. It does not relax the positive audio, timing or event assertions.
