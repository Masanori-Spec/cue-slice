# Security and privacy

The static app has no runtime dependencies or network calls. Its Content Security
Policy blocks connections, objects and form submission. User filenames and MIDI
metadata are displayed with `textContent`, never inserted as markup. Only fixed
translation strings use HTML for line breaks. No user data is saved in localStorage.
The JSON recipe is source-bound by SHA-256; imports reject mismatches. Clip filenames
are a narrow ASCII allowlist, with case-insensitive uniqueness, Windows device
basename rejection and no path traversal.

Input and output budgets fail closed. Review/edit/reset events invalidate stale
bundles; monotonically increasing revision numbers prevent late async reads/digests
from restoring outdated results. Download object URLs are revoked after 10 seconds.

The CLI reads only the requested local source/recipe and writes the requested output
folder. The ZIP does not contain the source MIDI, credentials, absolute local paths,
or the test soundfont. The runtime never installs software or calls the native test
renderer. Process only music you have permission to use; do not treat receipt text as
proof of copyright ownership, instrument compatibility or musical fidelity.

Not verified: hostile-file fuzzing beyond the checked-in bounded cases, all browsers,
real mobile devices, all DAWs, all soundfonts or external MIDI hardware.
