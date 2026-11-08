"""Independent decimal root enclosures and stopped-capital bounds."""
from decimal import Decimal, localcontext
import json
import sys

def bounds(ticket, capital):
    with localcontext() as ctx:
        ctx.prec = 90
        one, two = Decimal(1), Decimal(2)
        width = 120
        tail = two ** -width
        low, high = Decimal(0), two.ln() / (ticket - 1)
        for step in range(320):
            middle = (low + high) / 2
            head = Decimal(0)
            power = one
            for _ in range(width):
                exponent = middle * power
                lost = one if exponent > 300 else one - (-exponent).exp()
                head += lost / (2 * power)
                power *= 2
            target = one - (-middle * ticket).exp()
            if head > target:
                low = middle
            elif head + tail < target:
                high = middle
            else:
                break
        lower = one - (-low * (capital - ticket + 1)).exp()
        upper = one - (-high * (capital - 1)).exp()
        return {'ticket': ticket, 'capital': capital, 'alphaLow': str(low),
                'alphaHigh': str(high), 'lower': str(lower), 'upper': str(upper),
                'roundedLow': str(lower.quantize(Decimal('0.0000001'))),
                'roundedHigh': str(upper.quantize(Decimal('0.0000001'))), 'steps': step + 1}

if __name__ == '__main__':
    cases = [(int(sys.argv[1]), int(sys.argv[2]))] if len(sys.argv) > 1 else [(15, 10**9), (2, 2), (2, 5), (6, 10000),
        (3, 100), (10, 10**6), (20, 10**9), (25, 10**12),
        (15, 1000000065)]
    print(json.dumps([bounds(*case) for case in cases], indent=2))
