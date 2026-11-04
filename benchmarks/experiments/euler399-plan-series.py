import subprocess,json,sys
from pathlib import Path
out=Path(sys.argv[1]);node=sys.argv[2] if len(sys.argv)>2 else 'node'
with out.open('w') as f:
 for trial in range(3):
  for control in [True,False]:
   args=[node]+(['--import','./benchmarks/experiments/euler399-no-iterable-bindings.mjs'] if control else [])
   args+=['benchmarks/euler399-followup.mjs','5714285','compiled','demos/euler/399_squarefree.ra','full']
   p=subprocess.run(args,capture_output=True,text=True,timeout=180,check=True)
   x=json.loads(p.stdout);x.update(trial=trial,control=control);f.write(json.dumps(x)+'\n');f.flush()
