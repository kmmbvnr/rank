"""Fresh-process Euler 407 controls; run from the repository root."""
import json
import subprocess
import sys

node = sys.argv[1] if len(sys.argv) > 1 else 'node'
output = sys.argv[2] if len(sys.argv) > 2 else '/tmp/rank407-final-series-mac.jsonl'
original = 'benchmarks/experiments/euler407-original.ra'
final = 'demos/euler/407_idempotents.ra'
variants = [('original', original, []), ('final', final, []),
            ('no-ternary', final, ['--import', './benchmarks/experiments/euler407-no-ternary.mjs'])]

def run(label, source, flags, mode='compiled'):
    result = subprocess.run([node, *flags, 'benchmarks/euler404-investigation.mjs',
                             source, '10000000', mode], text=True,
                            capture_output=True, check=True, timeout=180)
    sample = json.loads(result.stdout)
    assert sample['answer'] == '39782849136421', sample
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
    for label, source in [('original-reference', original), ('final-reference', final)]:
        sample = run(label, source, [], 'reference')
        stream.write(json.dumps(sample) + '\n')
        stream.flush()
        print(label, sample['ms'], sample['rssMiB'], flush=True)
