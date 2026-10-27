import json,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
runtime=sys.argv[1] if len(sys.argv)>1 else str(root/'packages/interpreter/out/index.js')
base=['node',str(root/'benchmarks/euler213-flea-circus.mjs'),'--runtime='+runtime]
def oracle(n,rings):
 z=n*n; empty=[1.0]*z
 nb=[]
 for s in range(z):
  y,x=divmod(s,n); nb.append([a*n+b for a,b in [(y-1,x),(y+1,x),(y,x-1),(y,x+1)] if 0<=a<n and 0<=b<n])
 for start in range(z):
  p=[0.0]*z;p[start]=1.0
  for _ in range(rings):
   q=[0.0]*z
   for s in range(z):
    if not nb[s]: q[s]+=p[s]
    for dest in nb[s]: q[dest]+=p[s]/len(nb[s])
   p=q
  for dest in range(z):empty[dest]*=1-p[dest]
 return round(sum(empty),6)
results=[]
for n in range(1,8):
 for rings in [0,1,2,5]:
  expected=oracle(n,rings)
  variants=['shipping','original'] if n in [2,4,6] else ['shipping']
  for variant in variants:
   for ref in [False,True]:
    args=base+['--N='+str(n),'--Rings='+str(rings),'--variant='+variant]
    if ref:args+=['--reference']
    x=json.loads(subprocess.check_output(args,timeout=30));assert abs(float(x['answer'])-expected)<0.0000006,(n,rings,variant,ref,x['answer'],expected)
    results.append(dict(n=n,rings=rings,variant=variant,reference=ref,expected=expected,answer=x['answer']))
print(json.dumps({'passed':len(results),'checks':results},indent=2))
