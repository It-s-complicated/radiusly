#!/usr/bin/env python3
"""Standard-library checks for the Rust importer benchmark's correctness guard."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

benchmark = runpy.run_path(str(Path(__file__).with_name('benchmark-rust-import.py')))


class ComparisonTests(unittest.TestCase):
    def test_only_policy_suffix_is_normalized(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'graph.json'
            original = b'{"dataVersion":"0123456789abcdef-012345abcdef","nodes":[]}' + b' ' * 5000
            path.write_bytes(original)
            digest = benchmark['graph_digest'](path)
            expected = original.replace(b'-012345abcdef', b'-000000000000')
            self.assertEqual(digest, hashlib.sha256(expected).hexdigest())
            path.write_bytes(original.replace(b'-012345abcdef', b'-abcdef012345'))
            self.assertEqual(benchmark['graph_digest'](path), digest)
            path.write_bytes(original.replace(b'0123456789abcdef-', b'1123456789abcdef-'))
            self.assertNotEqual(benchmark['graph_digest'](path), digest)
            path.write_bytes(original.replace(b'"nodes":[]', b'"nodes":[1]'))
            self.assertNotEqual(benchmark['graph_digest'](path), digest)
            path.write_bytes(b'{}')
            with self.assertRaises(ValueError):
                benchmark['graph_digest'](path)

    def test_cli_summary_differences_fail_even_when_graph_digest_matches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.pbf'
            source.write_bytes(b'fixture')
            binary = root / 'binary'
            binary.touch()
            report = root / 'report.json'
            argv = ['benchmark', str(source), '--binary', f'a={binary}',
                    '--binary', f'b={binary}', '--runs', '1', '--report', str(report)]
            samples = [
                {'normalizedSha256': 'same', 'summary': {'bytes': 10, 'incompleteWaysSkipped': 0}},
                {'normalizedSha256': 'same', 'summary': {'bytes': 10, 'incompleteWaysSkipped': 1}},
            ]
            with patch('sys.argv', argv), patch.dict(benchmark['main'].__globals__,
                    measure=lambda *args: samples.pop(0)), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, 'output differs'):
                    benchmark['main']()
            self.assertFalse(report.exists())

    def test_existing_report_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / 'report.json'
            report.write_text(json.dumps({'keep': True}))
            argv = ['benchmark', str(root / 'input.pbf'), '--binary', f'a={report}',
                    '--report', str(report)]
            with patch('sys.argv', argv), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    benchmark['main']()
            self.assertEqual(json.loads(report.read_text()), {'keep': True})


if __name__ == '__main__':
    unittest.main()
