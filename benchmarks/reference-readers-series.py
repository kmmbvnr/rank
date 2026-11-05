import subprocess,json,sys,os
from pathlib import Path
base,candidate,node,out,*names=sys.argv[1:]
script=str(Path(candidate)/'benchmarks/reference-readers.mjs')
with open(out,'w') as f:
 for sample in range(int(os.environ.get('RANK_BENCH_SAMPLES', '3'))):
  for name in names or ['calls','powers','023','193','401','410','550']:
   for engine in os.environ.get('RANK_BENCH_ENGINES', 'reference compiled').split():
    for label,root in ([('baseline',base),('candidate',candidate)] if sample%2==0 else [('candidate',candidate),('baseline',base)]):
     p=subprocess.run([node,script,root,name,engine],capture_output=True,text=True,timeout=600)
     if p.returncode: raise RuntimeError(p.stderr)
     r=json.loads(p.stdout);r.update(sample=sample,variant=label);f.write(json.dumps(r)+'\n');f.flush()
     print(name,engine,label,sample,round(r['ms'],2),flush=True)
