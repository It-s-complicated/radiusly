#!/usr/bin/env python3
"""Rust CLI regression checks. Requires osmium and a built release binary."""
import json
import math
import os
from pathlib import Path
import runpy
import struct
import subprocess
import tempfile
import time
import zlib

import osmium

ROOT = Path(__file__).resolve().parent.parent
BINARY = ROOT / 'routing-graph-rs/target/release/routing-graph'
BOUNDS = ['13.3', '52.4', '13.5', '52.6']
# Reuse the access/barrier/restriction/station fixture and its Python assertions.
fixture = runpy.run_path(str(ROOT / 'scripts/test-walking-import.py'))


def command(source, output, region='fixture'):
    return [str(BINARY), str(source), str(output), '--region', region, '--bounds', *BOUNDS]


def build(source, output, region='fixture', threads=None):
    env = os.environ.copy()
    if threads is not None:
        env['RAYON_NUM_THREADS'] = str(threads)
    return subprocess.run(command(source, output, region), capture_output=True, text=True, env=env)


def write_pbf(path, points):
    with osmium.SimpleWriter(str(path)) as writer:
        for ref, (lat, lon) in enumerate(points, 1):
            writer.add_node(osmium.osm.mutable.Node(id=ref, location=(lon, lat)))
        writer.add_way(osmium.osm.mutable.Way(
            id=10, nodes=list(range(1, len(points) + 1)), tags={'highway': 'footway'}))


# Minimal protobuf encoding lets this check control blob boundaries and element
# types: libosmium's writer normally separates them into homogeneous blocks.
def varint(value):
    result = bytearray()
    while value >= 128:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def field(number, value):
    if isinstance(value, bytes):
        return varint(number * 8 + 2) + varint(len(value)) + value
    return varint(number * 8) + varint(value)


def packed(number, values, signed=False):
    return field(number, b''.join(varint(2 * value if value >= 0 else -2 * value - 1)
                                if signed else varint(value) for value in values))


def pbf_blob(kind, payload):
    blob = field(2, len(payload)) + field(3, zlib.compress(payload))
    header = field(1, kind.encode()) + field(3, len(blob))
    return struct.pack('>I', len(header)) + header + blob


def mixed_pbf():
    strings = ['', 'highway', 'footway', 'railway', 'halt', 'access', 'private',
               'type', 'restriction', 'restriction:foot', 'no_entry', 'station', 'outer']
    stringtable = b''.join(field(1, value.encode()) for value in strings)

    def tags(pairs):
        return packed(2, [key for key, _ in pairs]) + packed(3, [value for _, value in pairs])

    def node(ref, lat, lon, pairs=(), dense=False):
        if dense:
            data = packed(1, [ref], True) + packed(8, [lat], True) + packed(9, [lon], True)
            data += packed(10, [value for pair in pairs for value in pair] + [0])
            return field(2, data)
        data = field(1, 2 * ref) + tags(pairs) + field(8, 2 * lat) + field(9, 2 * lon)
        return field(1, data)

    def way(ref, refs, pairs=((1, 2),)):
        deltas = [refs[0], *[b - a for a, b in zip(refs, refs[1:])]]
        return field(3, field(1, ref) + tags(pairs) + packed(8, deltas, True))

    def relation(ref, member, pairs):
        return field(4, field(1, ref) + tags(pairs) + packed(8, [12])
                     + packed(9, [member], True) + packed(10, [1]))

    groups = [
        # A single blob with regular nodes, dense nodes, ways and relations.
        [node(1, 525000000, 134000000) + node(2, 525000000, 134010000),
         node(3, 525010000, 134000000, ((3, 4),), dense=True),
         way(90, [1, 2], ()) + way(80, [1, 2]),
         relation(40, 90, ((3, 11),))],
        [node(4, 525020000, 134000000, ((5, 6),)) + node(5, 525020000, 134020000)],
        [way(70, [2, 4, 5])],
        [node(6, 525030000, 134000000, dense=True), node(7, 525030000, 134010000),
         way(60, [6, 7]), relation(41, 70, ((7, 8), (9, 10)))],
        [],
        [way(50, [1, 999])],  # Missing dependency must not become a synthetic edge.
    ]
    # Non-sorted way IDs across >8 blobs catch reordering and batch-boundary bugs.
    groups.extend([[way(ref, [6, 7])] for ref in [44, 21, 43, 20, 42, 19, 41, 18, 40, 17]])
    header = field(4, b'OsmSchema-V0.6') + field(4, b'DenseNodes')
    blobs = [pbf_blob('OSMHeader', header)]
    blobs.extend(pbf_blob('OSMData', field(1, stringtable) + b''.join(field(2, group) for group in block))
                 for block in groups)
    return b''.join(blobs)


with tempfile.TemporaryDirectory(prefix='rust-import-test-') as directory:
    root = Path(directory)
    xml = root / 'fixture.osm'
    xml.write_text(fixture['xml'])
    source = root / 'fixture.osm.pbf'
    with osmium.SimpleWriter(str(source)) as writer, osmium.io.Reader(str(xml)) as reader:
        osmium.apply(reader, writer)
    original = source.read_bytes()
    output = root / 'graph.json'
    result = build(source, output)
    assert result.returncode == 0, result.stderr
    graph = json.loads(output.read_text())
    importer = fixture['module'].Importer([float(value) for value in BOUNDS])
    importer.apply_file(str(source), locations=True)
    expected = importer.graph('fixture', graph['dataVersion'])
    assert graph == expected
    assert json.loads(result.stdout)['bytes'] == output.stat().st_size

    # Mixed blobs, regular/dense nodes, missing dependencies and deterministic
    # input order must match the sequential reference at different thread counts.
    mixed = root / 'mixed.osm.pbf'
    mixed.write_bytes(mixed_pbf())
    importer = fixture['module'].Importer([float(value) for value in BOUNDS])
    importer.apply_file(str(mixed), locations=True)
    # osmpbf ignores unknown blob types; libosmium's reference reader rejects them.
    with mixed.open('ab') as target:
        target.write(pbf_blob('UnknownExtension', b'ignored'))
    deterministic = None
    for threads in [1, 2, 8, 16]:
        mixed_output = root / 'mixed.json'
        result = build(mixed, mixed_output, threads=threads)
        assert result.returncode == 0, result.stderr
        actual = json.loads(mixed_output.read_text())
        assert actual == importer.graph('fixture', actual['dataVersion'])
        assert json.loads(result.stdout)['incompleteWaysSkipped'] == 1
        if deterministic is None:
            deterministic = mixed_output.read_bytes()
        assert mixed_output.read_bytes() == deterministic

    # Failures must preserve both the PBF and the previously published graph.
    published = output.read_bytes()
    corrupt = root / 'corrupt.osm.pbf'
    corrupt.write_bytes(mixed.read_bytes()[:-10])
    result = build(corrupt, output)
    assert result.returncode != 0
    assert output.read_bytes() == published
    aliases = [source, Path(os.path.relpath(source))]
    symlink = root / 'symlink.pbf'
    symlink.symlink_to(source)
    hardlink = root / 'hardlink.pbf'
    os.link(source, hardlink)
    aliases.extend([symlink, hardlink])
    for alias in aliases:
        result = build(source, alias)
        assert result.returncode != 0 and 'different files' in result.stderr, result
        assert alias.read_bytes() == original
    assert source.read_bytes() == original
    result = build(source, output, '')
    assert result.returncode != 0 and 'region' in result.stderr, result
    assert output.read_bytes() == published

    cases = {
        'long': ([[52.5, 13.4], [52.5, 13.401], [52.5, 14.0]], 'segment length'),
        'polar': ([[52.5, 13.4], [86.0, 13.4]], 'coordinate'),
        'over-limit': ([[52.5, 13.4], [52.5 + math.degrees(20_001 / 6_371_000), 13.4]], 'segment length'),
    }
    for name, (points, error) in cases.items():
        invalid = root / f'{name}.osm.pbf'
        write_pbf(invalid, points)
        result = build(invalid, output)
        assert result.returncode != 0 and error in result.stderr, result
        assert output.read_bytes() == published
    short = root / 'under-limit.osm.pbf'
    write_pbf(short, [[52.5, 13.4], [52.5 + math.degrees(19_999 / 6_371_000), 13.4]])
    result = build(short, root / 'short.json')
    assert result.returncode == 0, result.stderr

    # A failed rename must clean up only this invocation's staging file.
    destination = root / 'directory'
    destination.mkdir()
    result = build(source, destination)
    assert result.returncode != 0
    assert not list(root.glob('*.tmp'))

    # Give concurrent writers enough data to overlap, with differing JSON sizes.
    concurrent = root / 'concurrent.osm.pbf'
    write_pbf(concurrent, [
        [52.5 + (index // 500) * 0.000001, 13.4 + (index % 500) * 0.000001]
        for index in range(50_000)
    ])
    regions = ['concurrent-' + 'x' * index for index in range(8)]
    processes = [subprocess.Popen(command(concurrent, output, region),
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                 for region in regions]
    while any(process.poll() is None for process in processes):
        observed = json.loads(output.read_text())
        assert observed == expected or (observed['region'] in regions and len(observed['edges']) == 49_999)
        time.sleep(0.005)
    for process in processes:
        stdout, stderr = process.communicate()
        assert process.returncode == 0, stderr
        assert json.loads(stdout)['segments'] == 49_999
    final = json.loads(output.read_text())
    assert final['region'] in regions and len(final['edges']) == 49_999
    assert not list(root.glob('*.tmp'))

print('Rust PBF parity, mixed blobs, deterministic parallel decoding, path safety, graph validation and concurrent publication checks passed.')
