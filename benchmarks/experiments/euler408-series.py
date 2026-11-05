"""Run Euler 408 research controls from the repository root."""
import json
import subprocess
import sys

node = sys.argv[1] if len(sys.argv) > 1 else 'node'
output = sys.argv[2] if len(sys.argv) > 2 else '/tmp/rank408-series-mac.jsonl'
original = 'demos/euler/408_admissiblepaths.ra'
candidate = 'benchmarks/experiments/euler408-candidate.ra'
prototype = ['--import', './benchmarks/experiments/euler408-modular-prototype.mjs']
variants = [('original', original, []), ('candidate', candidate, []),
            ('candidate+compiler', candidate, prototype)]

def run(label, source, flags, mode='compiled'):
    result = subprocess.run([node, *flags, 'benchmarks/euler408-investigation.mjs',
                             source, '10000000', mode], capture_output=True,
                            text=True, timeout=180, check=True)
    sample = json.loads(result.stdout)
    assert sample['answer'] == '299742733', sample
    sample['label'] = label
    return sample

with open(output, 'w') as stream:
    for ordinal in range(3):
        for label, source, flags in variants if ordinal % 2 == 0 else variants[::-1]:
            sample = run(label, source, flags)
            sample['round'] = ordinal
            stream.write(json.dumps(sample) + '\n')
            stream.flush()
            print(label, sample['ms'], sample['rssMiB'], flush=True)
    for label, source in [('original-reference', original), ('candidate-reference', candidate)]:
        sample = run(label, source, [], 'reference')
        stream.write(json.dumps(sample) + '\n')
        stream.flush()
        print(label, sample['ms'], sample['rssMiB'], flush=True)
