import json
import subprocess
import sys
from pathlib import Path

node = sys.argv[2] if len(sys.argv) > 2 else 'node'
variants = [
    ('original-compiled', 'benchmarks/experiments/euler404-original.ra', 'compiled', []),
    ('final-compiled', 'demos/euler/404_crazyellipses.ra', 'compiled', []),
    ('same-demo-without-wide-vector', 'demos/euler/404_crazyellipses.ra', 'compiled',
     ['--import', './benchmarks/experiments/euler404-no-wide-vector.mjs']),
]
with Path(sys.argv[1]).open('w') as output:
    def run(variant, trial):
        name, source, mode, options = variant
        result = subprocess.run([node, *options, 'benchmarks/euler404-investigation.mjs',
                                 source, '100000000000000000', mode],
                                capture_output=True, text=True, timeout=180, check=True)
        row = json.loads(result.stdout)
        assert row['answer'] == '1199215615081353', row
        row.update(variant=name, trial=trial)
        output.write(json.dumps(row) + '\n')
        output.flush()
        print(name, trial, row['ms'], row['rssMiB'], flush=True)
    for trial in range(3):
        for variant in (variants if trial % 2 == 0 else list(reversed(variants))):
            run(variant, trial)
    run(('original-reference', variants[0][1], 'reference', []), 0)
    run(('final-reference', variants[1][1], 'reference', []), 0)
