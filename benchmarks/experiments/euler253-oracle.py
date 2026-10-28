import json, math
from fractions import Fraction
from decimal import Decimal, localcontext

def solve(n):
    dp=[{} for _ in range(1<<n)];dp[0]={0:1}
    for mask in range(1<<n):
        for b in range(n):
            if mask>>b&1:continue
            nextmask=mask|1<<b
            segments=bin(nextmask & ~(nextmask<<1)).count('1')
            target=dp[nextmask]
            for maximum,ways in dp[mask].items():
                key=max(maximum,segments)
                target[key]=target.get(key,0)+ways
    counts=dp[-1];assert sum(counts.values())==math.factorial(n)
    average=Fraction(sum(k*v for k,v in counts.items()),math.factorial(n))
    with localcontext() as ctx:
        ctx.prec=40
        rounded=Decimal(average.numerator)/Decimal(average.denominator)
        text=format(rounded.quantize(Decimal('.000001')),'f').rstrip('0').rstrip('.')
    return {'N':n,'answer':text,'exact':str(average),'distribution':counts}
print(json.dumps([solve(n) for n in range(1,13)],indent=2))
