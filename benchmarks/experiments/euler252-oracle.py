# Independent small-input oracle: enumerate subsets, form convex hulls,
# and reject polygons with any strictly interior input point.
import itertools,json

def points(n):
 s=290797;t=[]
 for _ in range(2*n):
  s=s*s%50515093;t.append(s%2000-1000)
 return list(zip(t[::2],t[1::2]))
def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def hull(ps):
 ps=sorted(set(ps));lo=[];hi=[]
 for p in ps:
  while len(lo)>1 and cross(lo[-2],lo[-1],p)<=0:lo.pop()
  lo.append(p)
 for p in reversed(ps):
  while len(hi)>1 and cross(hi[-2],hi[-1],p)<=0:hi.pop()
  hi.append(p)
 return lo[:-1]+hi[:-1]
def oracle(n):
 ps=points(n);best=0
 for mask in range(1<<n):
  if bin(mask).count("1")<3:continue
  h=hull([p for i,p in enumerate(ps) if mask>>i&1]);edges=list(zip(h,h[1:]+h[:1]))
  area=abs(sum(a[0]*b[1]-a[1]*b[0] for a,b in edges))
  if area<=best:continue
  if any(all(cross(a,b,p)>0 for a,b in edges) for p in ps):continue
  best=area
 return best/2
if __name__=='__main__':print(json.dumps({n:oracle(n) for n in range(3,13)}))
