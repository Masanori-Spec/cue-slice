#!/usr/bin/env python3
"""An independent SMF oracle: fixtures and expected events do not use app code."""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile

import mido

ROOT = Path(__file__).resolve().parents[1]


def write_track(events):
    track = mido.MidiTrack()
    previous = 0
    for tick, message in events:
        assert tick >= previous, (tick, previous)
        track.append(message.copy(time=tick - previous))
        previous = tick
    return track


def save_midi(path, tracks, kind=0):
    midi = mido.MidiFile(type=kind, ticks_per_beat=480)
    midi.tracks.extend(write_track(events) for events in tracks)
    midi.save(path)


def fixture_sources(directory):
    """Hand-authored scores, deliberately unrelated to the app's fixtures/parser."""
    directory.mkdir(parents=True, exist_ok=True)
    meta = [
        (0, mido.MetaMessage('set_tempo', tempo=500000)),
        (0, mido.MetaMessage('time_signature', numerator=4, denominator=4)),
        (1920, mido.MetaMessage('end_of_track')),
    ]
    notes = [
        (0, mido.Message('program_change', channel=0, program=40)),
        (0, mido.Message('control_change', channel=0, control=7, value=90)),
        (0, mido.Message('control_change', channel=0, control=10, value=32)),
        (120, mido.Message('note_on', channel=0, note=60, velocity=80)),
        (240, mido.Message('control_change', channel=0, control=64, value=127)),
        (360, mido.Message('note_off', channel=0, note=60, velocity=49)),
        (600, mido.Message('note_on', channel=0, note=64, velocity=90)),
        (720, mido.Message('note_off', channel=0, note=64, velocity=30)),
        (840, mido.Message('control_change', channel=0, control=64, value=0)),
        (960, mido.Message('note_on', channel=0, note=67, velocity=100)),
        (1440, mido.Message('note_off', channel=0, note=67, velocity=20)),
        (1920, mido.MetaMessage('end_of_track')),
    ]
    merged = sorted(meta[:-1] + notes, key=lambda item: item[0])
    save_midi(directory / 'canonical-smf0.mid', [merged])
    save_midi(directory / 'canonical-smf1.mid', [meta, notes], kind=1)
    # Duration crop240..720 is 240/480*.4 + 240/480*1 = .7 sec.
    boundary = [
        (0, mido.MetaMessage('set_tempo', tempo=400000)),
        (0, mido.MetaMessage('time_signature', numerator=3, denominator=4)),
        (0, mido.Message('program_change', channel=2, program=8)),
        (120, mido.MetaMessage('text', text='BEFORE MUST NOT CARRY')),
        (240, mido.Message('note_on', channel=2, note=50, velocity=81)),
        (360, mido.Message('note_on', channel=2, note=50, velocity=0)),
        (480, mido.MetaMessage('set_tempo', tempo=1000000)),
        (540, mido.MetaMessage('marker', text='inside')),
        (600, mido.Message('note_on', channel=2, note=55, velocity=93)),
        (720, mido.Message('note_on', channel=2, note=63, velocity=100)),
        (900, mido.Message('note_off', channel=2, note=55, velocity=12)),
        (960, mido.Message('note_off', channel=2, note=63, velocity=13)),
        (1440, mido.MetaMessage('end_of_track')),
    ]
    save_midi(directory / 'tempo-boundaries.mid', [boundary])
    # No state or notes before 720: excerpt contains .25s leading + trailing silence.
    sparse = [
        (0, mido.MetaMessage('set_tempo', tempo=500000)),
        (720, mido.Message('note_on', channel=0, note=72, velocity=65)),
        (840, mido.Message('note_off', channel=0, note=72, velocity=99)),
        (1920, mido.MetaMessage('end_of_track')),
    ]
    save_midi(directory / 'sparse.mid', [sparse])


def row(tick, event, *values):
    return (tick, event, *values)


def read_rows(path_or_file):
    midi = (mido.MidiFile(file=path_or_file) if hasattr(path_or_file, 'read')
            else mido.MidiFile(path_or_file))
    assert midi.type == 0, f'output must be SMF0, got {midi.type}'
    assert len(midi.tracks) == 1
    assert midi.ticks_per_beat == 480
    result = []
    tick = 0
    for msg in midi.tracks[0]:
        tick += msg.time
        if msg.type in ('note_on', 'note_off'):
            result.append(row(tick, msg.type, msg.channel, msg.note, msg.velocity))
        elif msg.type == 'program_change':
            result.append(row(tick, msg.type, msg.channel, msg.program))
        elif msg.type == 'control_change':
            result.append(row(tick, msg.type, msg.channel, msg.control, msg.value))
        elif msg.type == 'set_tempo':
            result.append(row(tick, msg.type, msg.tempo))
        elif msg.type == 'time_signature':
            result.append(row(tick, msg.type, msg.numerator, msg.denominator,
                              msg.clocks_per_click, msg.notated_32nd_notes_per_beat))
        elif msg.type == 'end_of_track':
            result.append(row(tick, msg.type))
        elif msg.type in ('text', 'marker', 'track_name', 'copyright', 'lyrics'):
            result.append(row(tick, msg.type, msg.text if hasattr(msg, 'text') else msg.name))
        else:
            raise AssertionError(f'unexpected exported event: {msg}')
    return midi, result


# These are literal expected event sequences. Do not replace them with the
# application's parsing, crop algorithm, summaries, or generated expectations.
CANONICAL_PREFIX = [
    (0, 'set_tempo', 500000), (0, 'time_signature', 4, 4, 24, 8),
    (0, 'program_change', 0, 40),
    (0, 'control_change', 0, 1, 0), (0, 'control_change', 0, 7, 90),
    (0, 'control_change', 0, 10, 32), (0, 'control_change', 0, 11, 127),
    (0, 'control_change', 0, 64, 127),
]
CANONICAL_RETRIGGER = CANONICAL_PREFIX + [
    (0, 'note_on', 0, 60, 80), (0, 'note_off', 0, 60, 0),
    (120, 'note_on', 0, 64, 90), (240, 'note_off', 0, 64, 30),
    (360, 'control_change', 0, 64, 0), (480, 'note_on', 0, 67, 100),
    (720, 'note_off', 0, 67, 0), (720, 'control_change', 0, 64, 0),
    (720, 'end_of_track'),
]
CANONICAL_ONSETS = CANONICAL_PREFIX + [
    (120, 'note_on', 0, 64, 90), (240, 'note_off', 0, 64, 30),
    (360, 'control_change', 0, 64, 0), (480, 'note_on', 0, 67, 100),
    (720, 'note_off', 0, 67, 0), (720, 'control_change', 0, 64, 0),
    (720, 'end_of_track'),
]
HELD_PREFIX = [
    (0, 'set_tempo', 500000), (0, 'time_signature', 4, 4, 24, 8),
    (0, 'program_change', 0, 40),
    (0, 'control_change', 0, 1, 0), (0, 'control_change', 0, 7, 90),
    (0, 'control_change', 0, 10, 32), (0, 'control_change', 0, 11, 127),
    (0, 'control_change', 0, 64, 0),
]
HELD_RETRIGGER = HELD_PREFIX + [
    (0, 'note_on', 0, 67, 100), (240, 'note_off', 0, 67, 20),
    (480, 'control_change', 0, 64, 0), (480, 'end_of_track'),
]
HELD_ONSETS = HELD_PREFIX + [
    (480, 'control_change', 0, 64, 0), (480, 'end_of_track'),
]
BOUNDARY_EXPECTED = [
    (0, 'set_tempo', 400000), (0, 'time_signature', 3, 4, 24, 8),
    (0, 'program_change', 2, 8),
    (0, 'control_change', 2, 1, 0), (0, 'control_change', 2, 7, 100),
    (0, 'control_change', 2, 10, 64), (0, 'control_change', 2, 11, 127),
    (0, 'control_change', 2, 64, 0),
    (0, 'note_on', 2, 50, 81), (120, 'note_off', 2, 50, 0),
    (240, 'set_tempo', 1000000), (300, 'marker', 'inside'),
    (360, 'note_on', 2, 55, 93), (480, 'note_off', 2, 55, 0),
    (480, 'control_change', 2, 64, 0), (480, 'end_of_track'),
]
SPARSE_PREFIX = [
    (0, 'set_tempo', 500000), (0, 'time_signature', 4, 4, 24, 8),
    (0, 'program_change', 0, 0),
    (0, 'control_change', 0, 1, 0), (0, 'control_change', 0, 7, 100),
    (0, 'control_change', 0, 10, 64), (0, 'control_change', 0, 11, 127),
    (0, 'control_change', 0, 64, 0),
]
SPARSE_EXPECTED = SPARSE_PREFIX + [
    (240, 'note_on', 0, 72, 65), (360, 'note_off', 0, 72, 99),
    (960, 'control_change', 0, 64, 0), (960, 'end_of_track'),
]
SILENT_EXPECTED = SPARSE_PREFIX + [
    (240, 'control_change', 0, 64, 0), (240, 'end_of_track'),
]


def assert_exact(actual, expected, label):
    if actual != expected:
        raise AssertionError(f'{label}: event mismatch\nEXPECTED:\n'
                             + json.dumps(expected, indent=2)
                             + '\nACTUAL:\n' + json.dumps(actual, indent=2))


def export_case(source, recipe, output):
    output.mkdir(parents=True, exist_ok=True)
    recipe_path = output / 'input-recipe.json'
    recipe_path.write_text(json.dumps(recipe, indent=2) + '\n')
    process = subprocess.run(['node', str(ROOT / 'scripts/clip.mjs'), str(source),
                              str(recipe_path), str(output)], cwd=ROOT,
                             text=True, capture_output=True, timeout=30)
    assert process.returncode == 0, f'{source.name}: CLI failed: {process.stdout}\n{process.stderr}'
    return process.stdout


def inspect_bundle(directory, expected_names):
    required = {'excerpt-recipe.json', 'boundary-events.csv', 'recipient-guide.txt'}
    required.update(f'clips/{name}.mid' for name in expected_names)
    for name in required:
        assert (directory / name).is_file(), f'missing artifact: {name}'
    replay = json.loads((directory / 'excerpt-recipe.json').read_text())
    assert replay.get('version') == 1
    assert isinstance(replay.get('clips'), list) and len(replay['clips']) == len(expected_names)
    with (directory / 'boundary-events.csv').open(newline='') as handle:
        records = list(csv.DictReader(handle))
    assert records, 'boundary ledger must contain event records'
    assert (directory / 'recipient-guide.txt').read_text().strip(), 'empty recipient guide'
    with zipfile.ZipFile(directory / 'bundle.zip') as bundle:
        names = set(bundle.namelist())
        assert len(bundle.namelist()) == len(names), 'Duplicate ZIP entry names'
        assert required.issubset(names), (required, names)
        assert bundle.testzip() is None, 'ZIP CRC error'
        assert not any(name.startswith('/') or '..' in Path(name).parts for name in names)
        for name in required:
            assert bundle.read(name) == (directory / name).read_bytes(), name
    return {'files': sorted(required), 'boundaryRows': len(records)}


def run(output):
    fixture_sources(output / 'fixtures')
    cases = []
    plans = []
    for kind in (0, 1):
        plans.append((f'canonical-smf{kind}', [
            ({'name': 'retrigger', 'startTick': 480, 'endTick': 1200,
              'entryPolicy': 'retrigger'}, CANONICAL_RETRIGGER, .75),
            ({'name': 'onsets', 'startTick': 480, 'endTick': 1200,
              'entryPolicy': 'onsets'}, CANONICAL_ONSETS, .75),
            ({'name': 'held-retrigger', 'startTick': 1200, 'endTick': 1680,
              'entryPolicy': 'retrigger'}, HELD_RETRIGGER, .5),
            ({'name': 'held-onsets', 'startTick': 1200, 'endTick': 1680,
              'entryPolicy': 'onsets'}, HELD_ONSETS, .5),
        ]))
    plans.extend([
        ('tempo-boundaries', [({'name': 'boundary', 'startTick': 240,
           'endTick': 720, 'entryPolicy': 'onsets'}, BOUNDARY_EXPECTED, .7)]),
        ('sparse', [({'name': 'padded', 'startTick': 480, 'endTick': 1440,
          'entryPolicy': 'retrigger'}, SPARSE_EXPECTED, 1.0),
          ({'name': 'silent', 'startTick': 240, 'endTick': 480,
            'entryPolicy': 'onsets'}, SILENT_EXPECTED, .25)]),
    ])
    for source_name, tests in plans:
        destination = output / source_name
        recipe = {'version': 1, 'clips': [spec for spec, _, _ in tests]}
        export_case(output / 'fixtures' / f'{source_name}.mid', recipe, destination)
        bundle = inspect_bundle(destination, [spec['name'] for spec, _, _ in tests])
        for spec, expected, seconds in tests:
            path = destination / 'clips' / f'{spec["name"]}.mid'
            midi, actual = read_rows(path)
            label = f'{source_name}/{spec["name"]}'
            assert_exact(actual, expected, label)
            assert abs(midi.length - seconds) < 1e-9, (label, midi.length, seconds)
            with zipfile.ZipFile(destination / 'bundle.zip') as archive:
                _, archived = read_rows(io.BytesIO(archive.read(f'clips/{spec["name"]}.mid')))
            assert_exact(archived, expected, label + ' from ZIP')
            cases.append({'case': label, 'status': 'passed', 'events': len(actual),
                          'ticks': actual[-1][0], 'seconds': midi.length,
                          'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                          'bundle': bundle})
        # Reapply the actual exported recipe to the same source. Byte stability
        # is separate from, and additional to, the literal expected oracle.
        replay_out = destination / 'replay'
        replay = json.loads((destination / 'excerpt-recipe.json').read_text())
        export_case(output / 'fixtures' / f'{source_name}.mid', replay, replay_out)
        for spec, _, _ in tests:
            name = f'clips/{spec["name"]}.mid'
            assert (destination / name).read_bytes() == (replay_out / name).read_bytes(), name
    return {'status': 'passed', 'oracle': 'Mido 1.3.3; literal independently authored expectations',
            'casesPassed': len(cases), 'cases': cases}



def verify_browser_bundle(path, fixture_dir):
    """Consume a browser-downloaded ZIP against the same independent literals."""
    source = fixture_dir / 'canonical-smf0.mid'
    assert source.is_file(), f'Run oracle.py first to create the independent source: {source}'
    expected_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    expected_clips = [
        {'name': 'retrigger', 'startTick': 480, 'endTick': 1200, 'entryPolicy': 'retrigger'},
        {'name': 'onsets', 'startTick': 480, 'endTick': 1200, 'entryPolicy': 'onsets'},
    ]
    required = {'clips/retrigger.mid', 'clips/onsets.mid', 'excerpt-recipe.json',
                'boundary-events.csv', 'recipient-guide.txt'}
    cases = []
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, 'Browser ZIP CRC error'
        assert set(archive.namelist()) == required, archive.namelist()
        assert len(archive.namelist()) == len(required), 'Duplicate browser ZIP entry names'
        recipe = json.loads(archive.read('excerpt-recipe.json'))
        assert recipe['version'] == 1
        assert recipe['sourceSha256'] == expected_sha, 'Browser export does not match independent fixture'
        assert recipe['clips'] == expected_clips, recipe['clips']
        assert recipe['ppq'] == 480 and recipe['outputFormat'] == 0
        assert recipe['boundary'] == '[startTick,endTick)'
        ledger = list(csv.DictReader(io.StringIO(archive.read('boundary-events.csv').decode('utf-8'))))
        assert {record['clip'] for record in ledger} == {'retrigger', 'onsets'}
        assert archive.read('recipient-guide.txt').decode('utf-8').strip()
        for name, expected in [('retrigger', CANONICAL_RETRIGGER), ('onsets', CANONICAL_ONSETS)]:
            data = archive.read(f'clips/{name}.mid')
            midi, events = read_rows(io.BytesIO(data))
            assert_exact(events, expected, f'browser-download/{name}')
            assert abs(midi.length - .75) < 1e-9, (name, midi.length)
            cases.append({'case': name, 'status': 'passed', 'events': len(events),
                          'ticks': 720, 'seconds': midi.length,
                          'sha256': hashlib.sha256(data).hexdigest()})
    return {'status': 'passed', 'source': 'browser-downloaded ZIP, independently authored SMF0',
            'bundleSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'sourceSha256': expected_sha, 'casesPassed': len(cases), 'cases': cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT / 'test-results/oracle')
    parser.add_argument('--fixtures-only', action='store_true')
    parser.add_argument('--verify-browser-bundle', type=Path, metavar='FILE')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.fixtures_only and args.verify_browser_bundle:
        parser.error('--fixtures-only and --verify-browser-bundle are mutually exclusive')
    if args.fixtures_only:
        fixture_sources(args.out / 'fixtures')
        print(f'Created independent fixtures in {args.out / "fixtures"}')
        return
    report_path = args.out / ('browser-bundle-report.json' if args.verify_browser_bundle else 'oracle-report.json')
    try:
        report = (verify_browser_bundle(args.verify_browser_bundle, args.out / 'fixtures')
                  if args.verify_browser_bundle else run(args.out))
    except Exception as error:
        report_path.write_text(json.dumps({'status': 'failed', 'error': str(error)}, indent=2) + '\n')
        raise
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    label = 'Browser download Mido oracle' if args.verify_browser_bundle else 'Independent MIDI oracle'
    print(f'{label}: {report["casesPassed"]} cases passed; {report_path}')


if __name__ == '__main__':
    main()
