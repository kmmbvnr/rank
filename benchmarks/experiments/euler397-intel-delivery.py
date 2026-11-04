import subprocess, json, sys
with open(sys.argv[1], 'w') as output:
    for trial in range(3):
        for k, mode, control in [('100000','compiled',False),('100000','compiled',True),
                                  ('1000','reference',False),('1000000','compiled',False)]:
            cmd = ['node'] + (['--import', './benchmarks/experiments/euler397-broad-control.mjs'] if control else [])
            cmd += ['benchmarks/euler397-followup.mjs', k, mode]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode: raise RuntimeError(result.stderr)
            row = {'trial':trial, 'broadControl':control, **json.loads(result.stdout)}
            output.write(json.dumps(row)+'\n'); output.flush(); print(json.dumps(row),flush=True)
