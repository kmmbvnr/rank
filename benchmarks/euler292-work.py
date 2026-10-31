"""Count geometric candidate visits, without executing or reading DP cells."""
import json
from math import gcd,isqrt
for n in [60,120]:
 h=n//2;wx=2*h+1;wy=h+1
 count=dict(original=0,clipped=0,parity=0,radius=0);directions=0
 for dx in range(-h,h+1):
  for dy in range(h+1):
   r=isqrt(dx*dx+dy*dy)
   if not(dy>0 or dx>0) or gcd(dx,dy)!=1 or not 0<r<=h or r*r!=dx*dx+dy*dy:continue
   directions+=1;many=h//r
   count['original']+=(n-r+1)*wx*wy*many
   for t in range(r,n+1):
    rad=min(t,n-t)
    for m in range(1,min(many,t//r)+1):
     x=m*dx;y=m*dy
     count['clipped']+=(wx-abs(x))*(wy-y)
     for sx in range(max(-h,x-h),min(h,x+h)+1):
      lo=y+(t-sx-y)%2
      count['parity']+=max(0,(h-lo)//2+1)
     for sx in range(max(-rad,x-h),min(rad,x+h)+1):
      lo=y+(t-sx-y)%2;hi=isqrt(rad*rad-sx*sx)
      count['radius']+=max(0,(hi-lo)//2+1)
 print(json.dumps(dict(n=n,directions=directions,candidates=count)),flush=True)
