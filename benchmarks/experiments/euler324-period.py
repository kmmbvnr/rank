"""Exact finite-field period certificate for the demo's characteristic polynomial."""
import json,math,re,pathlib,time
p=100000007
assert all(p%d for d in range(2,math.isqrt(p)+1))
s=(pathlib.Path(__file__).parent/'euler324-original.ra').read_text()
c=[]
for line in s.splitlines():
 if line.startswith('C = array') or line.startswith('C = concat C'):c += [int(n) for n in re.findall(r'\d+',line)]
assert len(c)==23
f=[(-v)%p for v in reversed(c)]+[1]
def trim(a):
 while len(a)>1 and a[-1]==0:a.pop()
 return a

def rem(a,b):
 a=a[:];inv=pow(b[-1],-1,p)
 while len(a)>=len(b) and a!=[0]:
  q=a[-1]*inv%p;shift=len(a)-len(b)
  for i,v in enumerate(b):a[i+shift]=(a[i+shift]-q*v)%p
  trim(a)
 return a

def quotient(a,b):
 out=[0]*max(1,len(a)-len(b)+1);a=a[:];inv=pow(b[-1],-1,p)
 while len(a)>=len(b) and a!=[0]:
  q=a[-1]*inv%p;shift=len(a)-len(b);out[shift]=q
  for i,v in enumerate(b):a[i+shift]=(a[i+shift]-q*v)%p
  trim(a)
 assert a==[0]
 return trim(out)

def gcd(a,b):
 while b!=[0]:a,b=b,rem(a,b)
 inv=pow(a[-1],-1,p);return[(x*inv)%p for x in a]

def mul(a,b,m):
 out=[0]*(len(a)+len(b)-1)
 for i,x in enumerate(a):
  for j,y in enumerate(b):out[i+j]=(out[i+j]+x*y)%p
 return rem(trim(out),m)

def power(a,n,m):
 out=[1]
 while n:
  if n&1:out=mul(out,a,m)
  a=mul(a,a,m);n//=2
 return out

def subx(a):
 a=a[:]+[0]*max(0,2-len(a));a[1]=(a[1]-1)%p;return trim(a)

start=time.perf_counter()
repeated=gcd(f,[(i*f[i])%p for i in range(1,len(f))])
squarefree=quotient(f,repeated)
r=squarefree[:];h=[0,1];d=1;degrees=[]
while 2*d<=len(r)-1:
 h=power(h,p,r);g=gcd(r,subx(h))
 if len(g)>1:
  assert (len(g)-1)%d==0
  degrees += [d]*((len(g)-1)//d)
  r=quotient(r,g);h=rem(h,r)
 d+=1
if len(r)>1:degrees.append(len(r)-1)
assert sum(degrees)==len(squarefree)-1
period=math.lcm(*(p**d-1 for d in degrees))
if len(repeated)>1:period*=p
assert period==p*(p**2-1)*(p**3-1)*(p**5-1)//(p-1)**2
assert power([0,1],period,f)==[1]
print(json.dumps({'modulus':p,'degrees':degrees,'squarefreeDegree':len(squarefree)-1,'repeatedDegree':len(repeated)-1,'period':str(period),'periodBits':period.bit_length(),'certificate':'x^period == 1 mod characteristic polynomial','ms':(time.perf_counter()-start)*1000}))
