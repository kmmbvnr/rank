"""Run isolated, alternating process pairs for the ownership benchmark."""
import argparse
import json
import platform
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(__doc__)
parser.add_argument('--node', default='node')
parser.add_argument('--harness', default=str(Path(__file__).with_name('array-ownership.mjs')))
parser.add_argument('--before', required=True)
parser.add_argument('--after', required=True)
parser.add_argument('--before-revision', required=True)
parser.add_argument('--after-revision', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--repeats', type=int, default=6)
parser.add_argument('--iterations', type=int, default=1000)
parser.add_argument('--cases', nargs='+', default=['alias', 'slice', 'fresh', 'deque', 'read', 'unique'])
parser.add_argument('--gc', action='store_true')
args = parser.parse_args()
if args.repeats < 1 or args.iterations < 1:
    parser.error('repeats and iterations must be positive')
report = {
    'before': args.before_revision,
    'after': args.after_revision,
    'host': platform.platform(),
    'gc': args.gc,
    'harness': str(Path(args.harness).name),
    'protocol': 'One Node process per variant/case/pair. Alternate order by pair. Parsing and reference execution precede timing. Fresh samples use separate interpreters and a shared parsed program. Prepared samples reuse one interpreter. RSS includes reference, warmups and diagnostics. GC mode collects before each sample and after diagnostics.',
    'samples': [],
}
harness = Path(args.harness)
for pair in range(args.repeats):
    for case in args.cases:
        for variant in (['before', 'after'] if pair % 2 == 0 else ['after', 'before']):
            command = [args.node, *(['--expose-gc'] if args.gc else []), str(harness),
                       getattr(args, variant), case, str(args.iterations), *(['gc'] if args.gc else [])]
            data = json.loads(subprocess.check_output(command, text=True))
            report['samples'].append(dict(data, pair=pair, variant=variant))
            Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
        print(f'{pair + 1}/{args.repeats}: {case}', flush=True)
