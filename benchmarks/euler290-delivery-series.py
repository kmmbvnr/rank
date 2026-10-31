"""Run fresh serial, alternating before/after cases; no timing overlaps."""
import json
import subprocess
import sys

repeats = int(sys.argv[1]) if len(sys.argv) > 1 else 3
cases = [('before', 'compiled', 'original'), ('before', 'compiled', 'vector'),
         ('after', 'compiled', 'shipping'), ('before', 'reference', 'original'),
         ('after', 'reference', 'shipping')]
for file in ['026_reciprocal.ra', '104_pandigitalfib.ra', '129_repunitdiv.ra', '093_arithmeticexpr.ra']:
    for backend in ['before', 'after']:
        cases.append((backend, 'control', file))
results = []
for trial in range(repeats):
    for backend, mode, variant in cases if trial % 2 == 0 else reversed(cases):
        command = ['node']
        if backend == 'before':
            command += ['--import', './benchmarks/experiments/euler290-legacy-loader.mjs']
        command += (['benchmarks/euler289-controls.mjs', 'demos/euler/' + variant, 'compiled'] if mode == 'control'
                    else ['benchmarks/euler290-investigation.mjs', mode, variant])
        result = json.loads(subprocess.check_output(command, text=True))
        result.update(backend=backend, case=variant, mode=mode, trial=trial + 1)
        results.append(result)
        print(json.dumps(result), flush=True)
print(json.dumps({'samples': results}))
