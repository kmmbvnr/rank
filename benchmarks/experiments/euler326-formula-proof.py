"""Exact polynomial identities proving the six-term formulas by induction."""
from fractions import Fraction as F
import json
alpha=[4,3,1,6,1,3]
beta=[1,1,0,3,0,3]
slopes=[-1,3,6,7,13,14]
offsets=[0,1,2,2,5,5]
w=[0,-3,0,36]  # W_(6t) = 36t^3 - 3t
s=[0,-1,9]     # S_(6t) = 9t^2 - t
quotients=[]
for r,(a,b) in enumerate(zip(alpha,beta),1):
 assert s==[offsets[r-1],slopes[r-1],9]
 value=list(map(F,w));value[0]-=b;value[1]-=a
 q=[F(0)]*3
 for i in range(3,0,-1):
  q[i-1]=value[i]/6;value[i]-=6*q[i-1];value[i-1]-=r*q[i-1]
 assert value==[0]*4 and all(x.denominator==1 for x in q)
 quotients.append([int(x)for x in q])
 assert a>=0 and b>=0 and a<=6
 assert r-b>0 or (r==1 and a<6) # t=0,r=1 uses the given a_1=1
 # Add (6t+r)*(a*t+b) to W and a*t+b to S.
 w[0]+=r*b;w[1]+=6*b+r*a;w[2]+=6*a
 s[0]+=b;s[1]+=a
assert w==[33,105,108,36] # 36(t+1)^3 - 3(t+1)
assert s==[8,17,9]        # 9(t+1)^2 - (t+1)
print(json.dumps({'sequenceAlpha':alpha,'sequenceBeta':beta,'prefixSlopes':slopes,'prefixOffsets':offsets,'quotients':quotients,'exactIdentities':True,'prefixPeriod':'6*M since f_r(t+M)-f_r(t)=M*(18*t+9*M+b_r)'}))
