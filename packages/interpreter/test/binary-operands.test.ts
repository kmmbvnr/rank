import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

for (const compiled of [true, false]) describe(`binary operands (compiled: ${compiled})`, () => {
    const run = (source: string) => {
        const runtime = new Interpreter(() => {}, { scalarCompilation: compiled,
            integerLoopCompilation: compiled, blockCompilation: compiled, tensorFusion: compiled });
        try { return formatValue(runtime.execute(source)!); }
        finally { runtime.dispose(); }
    };
    it.each([
        ['use numbers\n12 gcd 8', '4'],
        ['use numbers\n(array 12 18) gcd (array 8 12)', '4 6'],
        ['use numbers\nA = array 12 18\nB = array 8 12\nA 1 gcd B 1', '6'],
        ['use numbers\nop = gcd\n12 op 8', '4'],
        ['use bits\n3 band 6', '2'],
        ['use algo\nSeen = new set\nX = Seen add 7 len\nX', '1'],
        ['use algo\nBag = new multiset\nBag add 1\nBag add 5\nLimits = array 3 6\nBag floor Limits 0', '1'],
        ['use algo\nBag = new multiset\nBag add 1\nBag add 5\nLimits = array 3 6\nop = floor\nBag op Limits 1', '5'],
        ['use graph\nD = new dsu (array 1 2)\nD merge 1 2\nNames = array 1 2\n(D findroot Names 0) equal (D findroot Names 1)', 'true'],
        ['fun A clamp B .with Limit=5 = (A + B) min Limit\n2 clamp 4', '5'],
        ['fun A clamp B .with Limit=5 = (A + B) min Limit\nA = array 1 8\nB = array 3 5\nA 0 clamp B 1 with 7', '6'],
        ['use dates\n("2026-01-01" calendar "2026-01-02") len', '2'],
        ['fun A step B = A + B\nfun X apply f = X f 3\n2 apply step', '5'],
        ['use text\n"a,b" split ","', 'a b'],
        ['use linalg\n(array 2 3) matmul (array 4 5)', '23'],
        ['fun A step B = A + B\n2 step 3', '5'],
        ['fun X inc = X + 1\nfun invoke f X = X f\ninc invoke 3', '4'],
        ['fun A add B = A + B\n2 add 3', '5'],
        ['fun A step B = A + B\n(array 1 2 3) scan step', '1 3 6'],
        ['fun A step B = A + B\n(array 1 2 3) reduce step', '6'],
        ['fun A step B rank 0 0 = A + B\n(array 1 2) (array 3 4) outer step', '4 5 5 6'],
        ['fun A step B = A + B\nop = step\n2 op 3', '5'],
    ])('evaluates %s', (source, expected) => expect(run(source)).toBe(expected));

    it('uses imported signatures and aliases without assuming a builtin arity', () => {
        const runtime = new Interpreter(() => {}, { compilation: compiled, loadModule: () => ({
            id: 'binary-helpers', source: 'fun X solve = X + 1\nfun A combine B = A + B',
        }) });
        try {
            expect(runtime.execute('use "binary-helpers"\n2 combine 3')).toBe(5n);
            expect(runtime.execute('2 solve')).toBe(3n);
            expect(runtime.execute('use "binary-helpers" as Ops\n2 Ops.combine 3')).toBe(5n);
            expect(formatValue(runtime.execute('(array 1 2 3) scan combine')!)).toBe('1 3 6');
        } finally { runtime.dispose(); }
    });
});
