"""Independent decimal oracle: integer pair eligibility, 60-digit logarithms."""
from decimal import Decimal, localcontext, ROUND_CEILING
import json, math

def solve(top, nines, precision=60):
    total, count, candidates = 0, 0, 0
    with localcontext() as ctx:
        ctx.prec = precision
        roots = [Decimal(p).sqrt() for p in range(top + 1)]
        log10 = Decimal(10).ln()
        nearest = Decimal('Infinity')
        for p in range(1, top):
            for d in range(1, min(top - 2*p, math.isqrt(4*p)+1)+1):
                candidates += 1
                if (d-1)**2 >= 4*p:
                    continue
                q = p+d
                beta = Decimal(d)/(roots[p]+roots[q])
                required = Decimal(nines)*log10/(-2*beta.ln())
                total += int(required.to_integral_value(rounding=ROUND_CEILING))
                nearest = min(nearest, abs(required-required.to_integral_value()))
                count += 1
    return dict(top=top,nines=nines,precision=precision,answer=str(total),eligiblePairs=count,boundedCandidates=candidates,nearestIntegerDistance=str(nearest))

if __name__ == '__main__':
    print(json.dumps([solve(t,n) for t,n in [(5,1),(20,2011),(100,2011),(2011,2011)]],indent=2))
