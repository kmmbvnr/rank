import subprocess, json, sys
cases = [('393_ants', []), ('185_numbermind', []), ('275_balancedsculptures', ['--n=12']),
         ('283_integertriangles', ['--top=30']), ('324_tower', ['--exp=500000']),
         ('337_totientstairs', ['--limit=10000']), ('391_hopping', ['--limit=100']),
         ('362_squarefree', ['--limit=100000']), ('364_distance', ['--n=10000'])]
with open(sys.argv[1], 'w') as output:
    for trial in range(3):
        for name, args in cases:
            rows = []
            for control in [False, True]:
                cmd = ['node'] + (['--import', './benchmarks/experiments/euler397-broad-control.mjs'] if control else [])
                cmd += ['benchmarks/mixed-loop-outputs.mjs', f'demos/euler/{name}.ra'] + args
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                if result.returncode: raise RuntimeError(result.stderr)
                row = {'trial': trial, 'broadControl': control, **json.loads(result.stdout)}
                rows.append(row); output.write(json.dumps(row)+'\n'); output.flush()
                print(json.dumps(row), flush=True)
            assert rows[0]['answer'] == rows[1]['answer'], name
