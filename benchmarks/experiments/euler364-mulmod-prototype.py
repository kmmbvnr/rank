# Research only: patch a disposable built runtime, never source or production out.
import sys
from pathlib import Path
p=Path(sys.argv[1])/'jit/scalar-function-kernel.js'
s=p.read_text()
s="import { multiply } from '../runtime/modular-power.js';\n"+s
before='        const left = lowerNum(compiled.left, lines), right = lowerNum(compiled.right, lines);'
patch='''        let product = compiled.left;
        while (product.kind === 'group') product = product.operand;
        if (op === 'mod' && compiled.signature.result === 'integer' && product.kind === 'binary' && product.operation.name === '*' && product.signature.result === 'integer') {
            const a = lowerNum(product.left, lines), b = lowerNum(product.right, lines), m = lowerNum(compiled.right, lines);
            if (!a || !b || !m) return undefined;
            const v = `v${serial++}`;
            lines.push(`const ${v} = mulmod(${a}, ${b}, ${m}, overflow);`);
            return v;
        }
'''
assert before in s
s=s.replace(before,patch+before,1)
old="return new Function('isqrt', source)(safeIntegerSquareRoot);"
new="""return new Function('isqrt', 'mulmod', source)(safeIntegerSquareRoot, (a,b,m,overflow) => {
            if (!(m > 0 && m <= 2 ** 30)) throw overflow;
            a = a >= 0 && a < m ? a : ((a % m) + m) % m;
            b = b >= 0 && b < m ? b : ((b % m) + m) % m;
            return multiply(a,b,m);
        });"""
assert old in s
s=s.replace(old,new,1)
p.write_text(s)
