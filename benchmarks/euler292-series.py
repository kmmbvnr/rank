"""Fresh processes, serial cases, alternating order; no overlapping tests."""
import hashlib,json,os,statistics,subprocess,sys
from pathlib import Path
cases=[('compiled','original','120'),('compiled','compact','120'),('reference','original','fixture'),('reference','compact','fixture'),('reference','compact','120'),('compiled','compact','fixture'),('compiled','sparse','120'),('compiled','slices','120')]
files=[p for p in Path('packages/interpreter/out').rglob('*.js')]
def fingerprint():
 h=hashlib.sha256()
 for p in sorted(files):h.update(str(p).encode());h.update(p.read_bytes())
 return h.hexdigest()
start=fingerprint();revision=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();rows=[]
for sample in range(int(sys.argv[1]) if len(sys.argv)>1 else 3):
 for mode,variant,n in (cases if sample%2==0 else list(reversed(cases))):
  p=subprocess.run(['node','benchmarks/euler292-investigation.mjs',mode,variant,n],capture_output=True,text=True,check=True,timeout=75)
  result=json.loads(p.stdout.splitlines()[-1]);r=dict(result,sample=sample);rows.append(r);print(json.dumps(r),flush=True)
assert fingerprint()==start,'Interpreter build changed during measurement'
summary=[]
for mode,variant,n in cases:
 rs=[r for r in rows if (r['mode'],r['variant'],str(r['n']))==(mode,variant,n)]
 summary.append(dict(mode=mode,variant=variant,n=n,medianMs=statistics.median(r['ms'] for r in rs),medianRssMiB=statistics.median(r['rssMiB'] for r in rs)))
print(json.dumps(dict(revision=revision,buildSha256=start,summary=summary)),flush=True)
