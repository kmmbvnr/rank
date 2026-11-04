"""Alternate fresh-process variants; run from the repository root."""
import json
import subprocess
import sys

node = sys.argv[2] if len(sys.argv) > 2 else 'node'
variants = [
    ('original', [], 'benchmarks/experiments/euler401-original.ra', 'compiled'),
    ('final', [], 'demos/euler/401_sumsquares.ra', 'compiled'),
    ('original-reference', [], 'benchmarks/experiments/euler401-original.ra', 'reference'),
    ('final-reference', [], 'demos/euler/401_sumsquares.ra', 'reference'),
    ('consumer-control', ['--import', './benchmarks/experiments/euler401-no-shared-inputs.mjs'], 'benchmarks/experiments/euler401-consumer.ra', 'compiled'),
    ('consumer-shared', [], 'benchmarks/experiments/euler401-consumer.ra', 'compiled'),
]
with open(sys.argv[1], 'w') as stream:
    for trial in range(3):
        for label, options, source, mode in variants[::1 if trial % 2 == 0 else -1]:
            result = json.loads(subprocess.check_output(
                [node, *options, 'benchmarks/euler401-investigation.mjs', source, '1000000000000000', mode],
                text=True, timeout=120))
            assert result['answer'] == '281632621', result
            result.update(variant=label, trial=trial)
            stream.write(json.dumps(result) + '\n')
            stream.flush()
            print(label, trial, round(result['ms']), round(result['rssMiB']), flush=True)
