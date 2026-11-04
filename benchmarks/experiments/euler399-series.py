import subprocess,json,sys
from pathlib import Path
out=Path(sys.argv[1])
node=sys.argv[2] if len(sys.argv)>2 else 'node'
with out.open('w') as f:
 for trial in range(3):
  for variant in ['original','stored','helper']:
   args=[node,'benchmarks/euler399-followup.mjs','5714285','compiled','benchmarks/experiments/euler399-'+variant+'.ra','full']
   p=subprocess.run(args,capture_output=True,text=True,timeout=120,check=True)
   x=json.loads(p.stdout);x.update(trial=trial,variant=variant);f.write(json.dumps(x)+'\n');f.flush()
