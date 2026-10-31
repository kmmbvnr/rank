"""Direct half-edge-set enumeration, without the demo's knapsack or bounds."""
from collections import Counter,defaultdict
from math import gcd,isqrt
import json,subprocess,sys
limit=40
half=limit//2
directions=[]
for x in range(-half,half+1):
 for y in range(half+1):
  r=isqrt(x*x+y*y)
  if (y>0 or x>0) and gcd(x,y)==1 and 0<r<=half and r*r==x*x+y*y:directions.append((x,y,r))
states=defaultdict(Counter)
def visit(at,x,y,perimeter,edges):
 if at==len(directions):
  states[x,y][perimeter,min(edges,3)]+=1;return
 dx,dy,r=directions[at]
 for m in range(min(half//r,(limit-perimeter)//r)+1):visit(at+1,x+m*dx,y+m*dy,perimeter+m*r,edges+(m>0))
visit(0,0,0,0,0)
hist=[0]*(limit+1)
for counter in states.values():
 for (p,a),left in counter.items():
  for (q,b),right in counter.items():
   if p+q<=limit and a+b>=3:hist[p+q]+=left*right
counts=[];total=0
for n,value in enumerate(hist):
 total+=value
 if n<=30 or n in [35,39,40]:counts.append([n,total])
assert dict(counts)[4]==1 and dict(counts)[30]==3655
print(json.dumps({'oracle':'direct half-edge-set enumeration, no coordinate/circle/parity pruning; exclude fewer than three edges','directions':len(directions),'halfSets':sum(sum(c.values()) for c in states.values()),'counts':counts}),flush=True)
variants=sys.argv[1:] or ['original','clipped','parity','radius','sparse','slices','continue','inline','compact']
for variant in variants:
 for mode in ['compiled','reference']:
  p=subprocess.run(['node','benchmarks/euler292-verify.mjs',variant,mode],input=json.dumps(counts),capture_output=True,text=True,timeout=60,check=True)
  print(p.stdout.strip(),flush=True)
