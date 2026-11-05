#!/usr/bin/env python3
"""Compare release graph builders on one PBF, without touching a published graph.

Example: python scripts/benchmark-rust-import.py source.osm.pbf \
    --binary baseline=/tmp/routing-graph-before \
    --binary candidate=routing-graph-rs/target/release/routing-graph \
    --report /tmp/graph-benchmark.json

Compile before running. Each binary gets a warm-up, then measured runs in
rotating/reversed order. Timings include the complete CLI (hashing through
publication), not compilation, download, or output comparison. Linux wait4
provides per-process CPU time and peak RSS. Outputs must be byte-identical
except for dataVersion's policy/source-code suffix; the input hash is preserved.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import statistics
import subprocess
import tempfile
import time


def file_digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def graph_digest(path):
    # dataVersion occurs near the beginning of the CLI's serialized Graph.
    # Keep comparison streaming so large artifacts do not inflate parent RSS.
    with path.open('rb') as source:
        prefix = source.read(4096)
        prefix, count = re.subn(rb'("dataVersion":"[0-9a-f]{16}-)[0-9a-f]{12}(")',
                                lambda match: match[1] + b'0' * 12 + match[2], prefix, count=1)
        if count != 1:
            raise ValueError(f'Missing expected dataVersion in {path}')
        digest = hashlib.sha256(prefix)
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def measure(binary, source, output, args):
    command = [str(binary), str(source), str(output), '--region', args.region,
               '--bounds', *map(str, args.bounds)]
    started = time.perf_counter()
    # Temporary stdout files avoid pipe deadlocks even if a CLI is verbose.
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(command, stdout=stdout, stderr=stderr)
        _, status, usage = os.wait4(process.pid, 0)
        elapsed = time.perf_counter() - started
        process.returncode = os.waitstatus_to_exitcode(status)
        stdout.seek(0)
        stderr.seek(0)
        if process.returncode:
            raise RuntimeError(f'{binary} failed: {stderr.read().decode()}')
        summary = json.load(stdout)
    return {'wallSeconds': elapsed, 'cpuSeconds': usage.ru_utime + usage.ru_stime,
            'peakRssKiB': usage.ru_maxrss, 'summary': summary,
            'normalizedSha256': graph_digest(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--binary', action='append', required=True, metavar='NAME=PATH')
    parser.add_argument('--runs', type=int, default=5)
    parser.add_argument('--warmups', type=int, default=1)
    parser.add_argument('--bounds', nargs=4, type=float, default=[13.08, 52.33, 13.77, 52.68])
    parser.add_argument('--region', default='berlin')
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--work-dir', type=Path, help='Parent of a new temporary output directory')
    args = parser.parse_args()
    if args.runs < 1 or args.warmups < 1:
        parser.error('--runs and --warmups must be positive')
    binaries = {}
    for item in args.binary:
        name, separator, path = item.partition('=')
        if not separator or not name or name in binaries:
            parser.error('--binary requires unique NAME=PATH entries')
        binaries[name] = Path(path).resolve(strict=True)
    if args.report.exists() or args.report.resolve() in [args.input.resolve(), *binaries.values()]:
        parser.error('Use a new report path; existing files are never overwritten')
    report = {
        'platform': platform.platform(), 'cpuCount': os.cpu_count(),
        'cpuModel': next((line.split(':', 1)[1].strip()
                          for line in Path('/proc/cpuinfo').read_text().splitlines()
                          if line.startswith('model name')), 'unknown'),
        'rayonNumThreads': os.environ.get('RAYON_NUM_THREADS', 'default'),
        'input': str(args.input.resolve()), 'inputBytes': args.input.stat().st_size,
        'inputSha256': file_digest(args.input),
        'bounds': args.bounds, 'region': args.region,
        'binaries': {name: {'path': str(path), 'sha256': file_digest(path)}
                     for name, path in binaries.items()},
        'warmups': [], 'samples': [], 'medians': {},
    }
    expected = None
    expected_summary = None
    names = list(binaries)
    with tempfile.TemporaryDirectory(prefix='rust-import-bench-', dir=args.work_dir) as directory:
        report['outputDirectory'] = directory
        for round_index in range(args.warmups + args.runs):
            warmup = round_index < args.warmups
            index = round_index if warmup else round_index - args.warmups
            order = names[index % len(names):] + names[:index % len(names)]
            if len(names) > 2 and index % 2:
                order.reverse()
            for name in order:
                result = measure(binaries[name], args.input.resolve(),
                                 Path(directory) / 'graph.json', args)
                summary = {key: value for key, value in result['summary'].items() if key != 'dataVersion'}
                if expected is None:
                    expected = result['normalizedSha256']
                    expected_summary = summary
                if result['normalizedSha256'] != expected or summary != expected_summary:
                    raise RuntimeError(f'{name}: output differs from the first binary')
                result.update(binary=name, round=index + 1)
                report['warmups' if warmup else 'samples'].append(result)
                print(json.dumps({'warmup': warmup, **result}), flush=True)
        for name in names:
            samples = [sample for sample in report['samples'] if sample['binary'] == name]
            report['medians'][name] = {
                key: statistics.median(sample[key] for sample in samples)
                for key in ['wallSeconds', 'cpuSeconds', 'peakRssKiB']
            }
    with args.report.open('x') as target:
        json.dump(report, target, indent=2)
        target.write('\n')
    print(json.dumps({'medians': report['medians'], 'report': str(args.report)}), flush=True)


if __name__ == '__main__':
    main()
