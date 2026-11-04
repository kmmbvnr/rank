"""Three alternating, fresh-process comparisons. Run from the repository root."""
import json
import subprocess
import sys

output = sys.argv[1]
node = sys.argv[2] if len(sys.argv) > 2 else 'node'
variants = [
    ('original', [], 'benchmarks/experiments/euler400-original.ra', 'compiled'),
    ('compiler-control', ['--import', './benchmarks/experiments/euler400-no-implicit-bitwise.mjs'], 'demos/euler/400_fibtree.ra', 'compiled'),
    ('final', [], 'demos/euler/400_fibtree.ra', 'compiled'),
    ('reference', [], 'demos/euler/400_fibtree.ra', 'reference'),
]
with open(output, 'w') as stream:
    for trial in range(3):
        for label, options, source, mode in variants[::1 if trial % 2 == 0 else -1]:
            completed = subprocess.run([node, *options, 'benchmarks/euler400-followup.mjs', source, '10000', mode],
                                       text=True, capture_output=True, timeout=120, check=True)
            result = json.loads(completed.stdout)
            assert result['answer'] == '438505383468410633', result
            result.update(variant=label, trial=trial)
            stream.write(json.dumps(result) + '\n')
            stream.flush()
            print(label, trial, round(result['ms']), round(result['rssMiB']), flush=True)
