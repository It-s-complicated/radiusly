#!/usr/bin/env python3
"""Measure importer phases without replacing the deployed graph; optionally profile Python calls."""
import argparse
import cProfile
import hashlib
import importlib.util
import json
import resource
import time
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('input', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--importer', type=Path, default=Path(__file__).with_name('build-walking-graph.py'))
parser.add_argument('--bounds', nargs=4, type=float, default=[13.08, 52.33, 13.77, 52.68])
parser.add_argument('--region', default='berlin')
parser.add_argument('--json', choices=['dump', 'dumps'], default='dumps')
parser.add_argument('--profile', type=Path)
args = parser.parse_args()
if args.output.exists() or args.input.resolve() == args.output.resolve():
    parser.error('Use a new output path; existing files are never overwritten.')

spec = importlib.util.spec_from_file_location('walking_import', args.importer)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
timings = {}
started = time.perf_counter()
profiler = cProfile.Profile() if args.profile else None
if profiler:
    profiler.enable()
with args.input.open('rb') as source:
    digest = hashlib.file_digest(source, 'sha256').hexdigest()
timings['hash'] = time.perf_counter() - started

relation_apply = module.StationRelations.apply_file
def timed_relations(self, *a, **kw):
    before = time.perf_counter()
    result = relation_apply(self, *a, **kw)
    timings['relations'] = time.perf_counter() - before
    return result
module.StationRelations.apply_file = timed_relations

before = time.perf_counter()
importer = module.Importer(args.bounds)
importer.apply_file(str(args.input), locations=True, idx='flex_mem')
timings['entities'] = time.perf_counter() - before - timings['relations']
before = time.perf_counter()
policy = hashlib.sha256(args.importer.read_bytes()).hexdigest()[:12]
graph = importer.graph(args.region, f'{digest[:16]}-{policy}')
timings['graph'] = time.perf_counter() - before
before = time.perf_counter()
args.output.parent.mkdir(parents=True, exist_ok=True)
with args.output.open('x') as output:
    if args.json == 'dumps':
        output.write(json.dumps(graph, separators=(',', ':'), allow_nan=False))
    else:
        json.dump(graph, output, separators=(',', ':'), allow_nan=False)
timings['json'] = time.perf_counter() - before
if profiler:
    profiler.disable()
    profiler.dump_stats(str(args.profile))
print(json.dumps({
    'seconds': timings, 'totalSeconds': time.perf_counter() - started,
    'peakRssKiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    'nodes': len(graph['nodes']), 'segments': len(graph['edges']),
    'stations': len(graph['stations']), 'bytes': args.output.stat().st_size,
    'dataVersion': graph['dataVersion'], 'json': args.json,
    'profiled': bool(profiler),
}), flush=True)
