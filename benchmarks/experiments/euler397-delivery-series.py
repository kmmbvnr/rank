import subprocess, json, sys
# Run from the repository root. Each process asserts its known 397 answer.
path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/rank397-delivery.jsonl'
with open(path, 'w') as output:
    for trial in range(3):
        for mode, control in [('compiled', False), ('compiled', True), ('reference', False)]:
            k = '10000' if mode == 'reference' else '1000000'
            command = ['node'] + (['--import', './benchmarks/experiments/euler397-broad-control.mjs'] if control else [])
            command += ['benchmarks/euler397-followup.mjs', k, mode]
            result = subprocess.run(command, capture_output=True, text=True, timeout=120)
            if result.returncode: raise RuntimeError(result.stderr)
            row = {'trial': trial, 'broadControl': control, **json.loads(result.stdout)}
            output.write(json.dumps(row) + '\n'); output.flush()
            print(json.dumps(row), flush=True)
