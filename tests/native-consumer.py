#!/usr/bin/env python3
"""Load actual exported SMF files in native FluidSynth; render and inspect WAV."""
from __future__ import annotations
import argparse
import array
import ctypes as C
import ctypes.util
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import wave
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOUNDFONT_SHA256 = 'c5378b62028c920cb11e4803327983fee2f2cdff5dc89c708e39da417e51c854'
RATE = 44100
BLOCK = 64
POST_PLAYER_SECONDS = 3


def bind(lib, name, result, *arguments):
    method = getattr(lib, name)
    method.restype = result
    method.argtypes = list(arguments)
    return method


class FluidSynth:
    def __init__(self):
        name = ctypes.util.find_library('fluidsynth')
        if not name:
            raise RuntimeError('Native FluidSynth is required; install official libfluidsynth3')
        self.name = name
        self.lib = C.CDLL(name)
        P, I, S, D = C.c_void_p, C.c_int, C.c_char_p, C.c_double
        self.callback_type = C.CFUNCTYPE(I, P, P)
        signatures = {
            'fluid_version_str': (S,),
            'new_fluid_settings': (P,), 'delete_fluid_settings': (None, P),
            'fluid_settings_setstr': (I, P, S, S),
            'fluid_settings_setint': (I, P, S, I),
            'fluid_settings_setnum': (I, P, S, D),
            'new_fluid_synth': (P, P), 'delete_fluid_synth': (None, P),
            'fluid_synth_sfload': (I, P, S, I),
            'fluid_synth_handle_midi_event': (I, P, P),
            'new_fluid_player': (P, P), 'delete_fluid_player': (None, P),
            'fluid_player_add': (I, P, S), 'fluid_player_play': (I, P),
            'fluid_player_get_status': (I, P), 'fluid_player_get_total_ticks': (I, P),
            'fluid_player_get_current_tick': (I, P),
            'fluid_player_set_playback_callback': (I, P, self.callback_type, P),
            'fluid_player_stop': (I, P), 'fluid_player_join': (I, P),
            'new_fluid_file_renderer': (P, P), 'delete_fluid_file_renderer': (None, P),
            'fluid_file_renderer_process_block': (I, P),
            'fluid_midi_event_get_type': (I, P),
            'fluid_midi_event_get_channel': (I, P),
            'fluid_midi_event_get_key': (I, P),
            'fluid_midi_event_get_velocity': (I, P),
        }
        for name, signature in signatures.items():
            setattr(self, name, bind(self.lib, name, *signature))
        self.version = self.fluid_version_str().decode('ascii')

    @staticmethod
    def okay(result, label):
        if result != 0:
            raise RuntimeError(f'{label} returned {result}')

    def render(self, midi, soundfont, wav):
        settings = synth = player = renderer = None
        notes, callback_errors = [], []
        rendered_frames = 0
        total_ticks = 0
        try:
            settings = self.new_fluid_settings()
            if not settings:
                raise RuntimeError('new_fluid_settings failed')
            for key, value in {
                'audio.file.name': str(wav.resolve()),
                'audio.file.type': 'wav', 'audio.file.format': 's16',
                'player.timing-source': 'sample',
            }.items():
                self.okay(self.fluid_settings_setstr(settings, key.encode(), value.encode()), key)
            for key, value in {
                'synth.lock-memory': 0, 'synth.reverb.active': 0,
                'synth.chorus.active': 0, 'synth.cpu-cores': 1,
                'player.reset-synth': 0, 'audio.period-size': BLOCK,
            }.items():
                self.okay(self.fluid_settings_setint(settings, key.encode(), value), key)
            for key, value in {'synth.sample-rate': RATE, 'synth.gain': .2}.items():
                self.okay(self.fluid_settings_setnum(settings, key.encode(), value), key)
            synth = self.new_fluid_synth(settings)
            if not synth:
                raise RuntimeError('new_fluid_synth failed')
            if self.fluid_synth_sfload(synth, os.fsencode(soundfont), 1) < 0:
                raise RuntimeError('FluidSynth could not load pinned test soundfont')
            player = self.new_fluid_player(synth)
            if not player:
                raise RuntimeError('new_fluid_player failed')

            @self.callback_type
            def callback(data, event):
                # Retain the callback through the complete C lifecycle. Never
                # raise through ctypes: record errors and assert after rendering.
                try:
                    kind = self.fluid_midi_event_get_type(event)
                    if kind in (0x80, 0x90):
                        notes.append({
                            'kind': 'note_on' if kind == 0x90 else 'note_off',
                            'channel': self.fluid_midi_event_get_channel(event),
                            'note': self.fluid_midi_event_get_key(event),
                            'velocity': self.fluid_midi_event_get_velocity(event),
                            'renderedSeconds': rendered_frames / RATE,
                            'playerTick': self.fluid_player_get_current_tick(player),
                        })
                    return self.fluid_synth_handle_midi_event(data, event)
                except Exception as error:
                    callback_errors.append(str(error))
                    return -1

            self.okay(self.fluid_player_set_playback_callback(player, callback, synth), 'set callback')
            self.okay(self.fluid_player_add(player, os.fsencode(midi)), 'add exported MIDI')
            self.okay(self.fluid_player_play(player), 'play exported MIDI')
            renderer = self.new_fluid_file_renderer(synth)
            if not renderer:
                raise RuntimeError('new_fluid_file_renderer failed')
            # No audio device, realtime thread, app parser, or manually injected
            # note calls. Native SMF parser and sequencer drive the synthesizer.
            while self.fluid_player_get_status(player) == 1:
                if rendered_frames > RATE * 15:
                    raise AssertionError('Native file player exceeded 15-second safety limit')
                self.okay(self.fluid_file_renderer_process_block(renderer), 'render block')
                rendered_frames += BLOCK
                total_ticks = max(total_ticks, self.fluid_player_get_total_ticks(player))
            status = self.fluid_player_get_status(player)
            assert status == 3, f'player did not finish normally: {status}'
            assert not callback_errors, callback_errors
            # Player completion is not synth silence. In FluidSynth2.2.5 the
            # player can finish at EOT while the final release envelope is active.
            # Render a fixed, bounded tail without resets, extra MIDI messages,
            # forced all-sounds-off or changing the MIDI's declared duration.
            frames_at_player_done = rendered_frames
            for _ in range(math.ceil(POST_PLAYER_SECONDS * RATE / BLOCK)):
                self.okay(self.fluid_file_renderer_process_block(renderer), 'render release tail')
                rendered_frames += BLOCK
            assert not callback_errors, callback_errors
            return {'notes': notes, 'totalTicks': total_ticks, 'playerStatus': 'done',
                    'renderedFrames': rendered_frames,
                    'framesAtPlayerDone': frames_at_player_done,
                    'postPlayerFrames': rendered_frames - frames_at_player_done}
        finally:
            if player:
                self.fluid_player_stop(player)
                self.fluid_player_join(player)
            if renderer:
                self.delete_fluid_file_renderer(renderer)
            if player:
                self.delete_fluid_player(player)
            if synth:
                self.delete_fluid_synth(synth)
            if settings:
                self.delete_fluid_settings(settings)


def read_audio(path):
    with wave.open(str(path), 'rb') as wav:
        assert wav.getnchannels() == 2 and wav.getsampwidth() == 2
        assert wav.getframerate() == RATE
        samples = array.array('h', wav.readframes(wav.getnframes()))
        if sys.byteorder != 'little':
            samples.byteswap()
        return samples


def rms(samples, start, end):
    window = samples[int(start * RATE) * 2:int(end * RATE) * 2]
    assert window, (start, end)
    return math.sqrt(sum(sample * sample for sample in window) / len(window))


def dpkg_versions():
    try:
        result = subprocess.run(['dpkg-query', '-W', '-f=${Package}=${Version}\n',
                                 'libfluidsynth3', 'timgm6mb-soundfont'],
                                capture_output=True, text=True, timeout=10)
        return {'returncode': result.returncode, 'output': result.stdout.strip(),
                'diagnostic': result.stderr.strip()}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'unavailable': str(error)}


def run(args):
    assert args.soundfont.is_file(), f'Missing test-only SoundFont: {args.soundfont}'
    sf_hash = hashlib.sha256(args.soundfont.read_bytes()).hexdigest()
    assert sf_hash == SOUNDFONT_SHA256, ('SoundFont does not match pinned test asset', sf_hash)
    synth = FluidSynth()
    specs = [
        ('retrigger', args.oracle / 'canonical-smf1/clips/retrigger.mid', 720, .75,
         [('note_on', 0, 60, 80, 0.), ('note_off', 0, 60, 0, 0.),
          ('note_on', 0, 64, 90, .125), ('note_off', 0, 64, 30, .25),
          ('note_on', 0, 67, 100, .5), ('note_off', 0, 67, 0, .75)]),
        ('onsets', args.oracle / 'canonical-smf1/clips/onsets.mid', 720, .75,
         [('note_on', 0, 64, 90, .125), ('note_off', 0, 64, 30, .25),
          ('note_on', 0, 67, 100, .5), ('note_off', 0, 67, 0, .75)]),
        ('tempo-boundary', args.oracle / 'tempo-boundaries/clips/boundary.mid', 480, .7,
         [('note_on', 2, 50, 81, 0.), ('note_off', 2, 50, 0, .1),
          ('note_on', 2, 55, 93, .45), ('note_off', 2, 55, 0, .7)]),
        ('padded', args.oracle / 'sparse/clips/padded.mid', 960, 1.,
         [('note_on', 0, 72, 65, .25), ('note_off', 0, 72, 99, .375)]),
        ('silent', args.oracle / 'sparse/clips/silent.mid', 240, .25, []),
    ]
    bundle_evidence = None
    if args.browser_bundle:
        # Fixed small independent fixture only. Never extract arbitrary ZIP paths,
        # and bound advertised uncompressed bytes before reading or CRC traversal.
        assert args.browser_bundle.is_file(), 'Missing downloaded ZIP artifact'
        assert args.browser_bundle.stat().st_size <= 1024 * 1024, 'Bundle file exceeds test bound'
        with zipfile.ZipFile(args.browser_bundle) as archive:
            info = archive.infolist()
            assert len(info) == 5, 'Expected two clips and three handoff files'
            assert sum(item.file_size for item in info) <= 1024 * 1024, 'Bundle expands beyond test bound'
        from oracle import verify_browser_bundle
        preflight = verify_browser_bundle(args.browser_bundle, args.oracle / 'fixtures')
        local_clips = args.out / 'downloaded-clips'
        local_clips.mkdir(exist_ok=True)
        with zipfile.ZipFile(args.browser_bundle) as archive:
            for name in ('retrigger', 'onsets'):
                (local_clips / f'{name}.mid').write_bytes(archive.read(f'clips/{name}.mid'))
        specs = [(name, local_clips / f'{name}.mid', ticks, duration, expected)
                 for name, _, ticks, duration, expected in specs[:2]]
        bundle_evidence = {
            'filename': args.browser_bundle.name,
            'sha256': hashlib.sha256(args.browser_bundle.read_bytes()).hexdigest(),
            'inputRoute': 'ZIP members copied byte-for-byte into native MIDI-file player',
            'provenance': 'Artifact origin is established by the calling workflow, not by this consumer',
            'independentMidoPreflight': preflight,
        }
    cases = []
    for name, midi, ticks, duration, expected in specs:
        assert midi.is_file(), f'Run tests/oracle.py first: missing {midi}'
        wav = args.out / f'{name}.wav'
        result = synth.render(midi, args.soundfont, wav)
        actual = [(event['kind'], event['channel'], event['note'], event['velocity'])
                  for event in result['notes']]
        assert actual == [event[:4] for event in expected], (name, actual, expected)
        assert result['totalTicks'] == ticks, (name, result['totalTicks'], ticks)
        for event, want in zip(result['notes'], expected):
            assert abs(event['renderedSeconds'] - want[4]) <= .015, (name, event, want)
        audio = read_audio(wav)
        seconds = len(audio) / (2 * RATE)
        assert duration <= seconds <= duration + 12, (name, seconds)
        tail_rms = rms(audio, seconds - .2, seconds - .02)
        assert tail_rms <= 2, (name, 'release tail must become silent', tail_rms)
        metrics = {'durationSeconds': seconds, 'tailRms16bit': tail_rms}
        if name == 'retrigger':
            metrics['entryRms16bit'] = rms(audio, .04, .10)
            assert metrics['entryRms16bit'] > 10, metrics
        elif name == 'onsets':
            metrics['entryRms16bit'] = rms(audio, .02, .10)
            metrics['laterRms16bit'] = rms(audio, .17, .22)
            assert metrics['entryRms16bit'] <= 2 and metrics['laterRms16bit'] > 10, metrics
        elif name == 'padded':
            metrics['entryRms16bit'] = rms(audio, .02, .20)
            metrics['laterRms16bit'] = rms(audio, .28, .34)
            assert metrics['entryRms16bit'] <= 2 and metrics['laterRms16bit'] > 10, metrics
        elif name == 'silent':
            metrics['peak16bit'] = max(map(abs, audio), default=0)
            assert metrics['peak16bit'] <= 2, metrics
        cases.append({'case': name, 'status': 'passed', 'midiSha256': hashlib.sha256(midi.read_bytes()).hexdigest(),
                      'native': result, 'audio': metrics})
    # Negative control: some native players release voices automatically at EOF.
    # Audio silence therefore cannot establish that the SMF contained closure.
    # Remove the required final off while retaining absolute ticks, and verify
    # the real native callback stream exposes the missing message.
    import mido
    corrupt = mido.MidiFile(str(specs[0][1]))
    removed = 0
    for track in corrupt.tracks:
        rewritten = mido.MidiTrack()
        pending_delta = 0
        for message in track:
            if message.type == 'note_off' and message.channel == 0 and message.note == 67:
                removed += 1
                pending_delta += message.time
            else:
                rewritten.append(message.copy(time=message.time + pending_delta))
                pending_delta = 0
        track[:] = rewritten
    assert removed == 1, ('negative control requires one final pitch67 off', removed)
    negative_midi = args.out / 'negative-missing-final-off.mid'
    corrupt.save(str(negative_midi))
    negative_native = synth.render(negative_midi, args.soundfont, args.out / 'negative-missing-final-off.wav')
    negative_events = [(event['kind'], event['channel'], event['note'], event['velocity'])
                       for event in negative_native['notes']]
    required_events = [event[:4] for event in specs[0][4]]
    assert negative_events != required_events, 'Native callback oracle failed to detect missing closure'
    assert ('note_off', 0, 67, 0) not in negative_events, negative_events
    negative_controls = [{'case': 'missing-final-note-off', 'status': 'detected',
                          'criterion': 'literal native callback event mismatch, not tail silence',
                          'expectedNoteEvents': len(required_events),
                          'observedNoteEvents': len(negative_events),
                          'midiSha256': hashlib.sha256(negative_midi.read_bytes()).hexdigest(),
                          'native': negative_native}]
    return {'status': 'passed', 'consumer': 'native FluidSynth MIDI player + file renderer',
            'library': synth.name, 'fluidSynthVersion': synth.version,
            'platform': platform.platform(), 'systemPackages': dpkg_versions(),
            'soundfont': {'filename': args.soundfont.name, 'sha256': sf_hash,
                          'testOnly': True, 'redistributed': False},
            'sampleRate': RATE, 'blockSize': BLOCK, 'postPlayerTailSeconds': POST_PLAYER_SECONDS, 'casesPassed': len(cases), 'cases': cases,
            'negativeControls': negative_controls,
            'inputMode': 'provided-zip-artifact' if args.browser_bundle else 'oracle-cli-exports',
            'sourceZip': bundle_evidence}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--oracle', type=Path, default=ROOT / 'test-results/oracle')
    parser.add_argument('--browser-bundle', type=Path, metavar='FILE',
                        help='Consume retrigger/onsets bytes from the actual browser ZIP artifact')
    parser.add_argument('--out', type=Path, default=ROOT / 'test-results/native')
    parser.add_argument('--soundfont', type=Path, default=Path('/usr/share/sounds/sf2/TimGM6mb.sf2'))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report_path = args.out / 'native-consumer-report.json'
    try:
        report = run(args)
    except Exception as error:
        report_path.write_text(json.dumps({'status': 'failed', 'error': str(error)}, indent=2) + '\n')
        raise
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Native FluidSynth consumer: {report["casesPassed"]} cases passed; {report_path}')


if __name__ == '__main__':
    main()
