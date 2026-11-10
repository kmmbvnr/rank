import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const maximum = 9007199254740991n;
const cases = [
    [2n, 3n, 3n, 2n],
    [-7n, 11n, 7n, -11n],
    [1n, 1n, 1n, 2n],
    [maximum, maximum - 2n, maximum - 1n, maximum - 1n],
    [maximum - 1n, maximum - 1n, maximum, maximum - 2n],
    [maximum, maximum, maximum, maximum],
    [-maximum, maximum - 2n, 1n - maximum, maximum - 1n],
    [-maximum, -maximum, maximum, maximum],
    [0n, maximum, -maximum, 0n],
    [maximum, 17n, maximum, 18n],
];
let seed = 391n;
for (let i = 0; i < 200; i++) {
    const row: bigint[] = [];
    for (let j = 0; j < 4; j++) {
        seed = (seed * 6364136223846793005n + 1n) & ((1n << 64n) - 1n);
        row.push(seed % (2n * maximum + 1n) - maximum);
    }
    cases.push(row);
}
const operators = ['less', 'at most', 'greater', 'at least', 'equal', 'not equal'] as const;
function compare(op: typeof operators[number], a: bigint, b: bigint) {
    switch (op) {
        case 'less': return a < b;
        case 'at most': return a <= b;
        case 'greater': return a > b;
        case 'at least': return a >= b;
        case 'equal': return a === b;
        case 'not equal': return a !== b;
    }
}
it.each(operators)('compares integer products exactly with %s without replaying on rounded ties', op => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    const arrays = ['A', 'B', 'C', 'D'].map((name, col) => `${name} = array ${cases.map(row => row[col]).join(' ')}`).join('\n');
    try {
        runtime.execute(arrays);
        diagnostics.run(() => runtime.execute(`Result = array shape ${cases.length} fill false
for I in 0 till ${cases.length}
 Left = A I
 Right = B I
 Other = C I
 Last = D I
 Result I = Left * Right ${op} Other * Last
end`));
        const result = runtime.variables.get('Result') as { items: Iterable<unknown> };
        expect([...result.items]).toEqual(cases.map(([a, b, c, d]) => compare(op, a * b, c * d)));
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
});
it('retains exact replay when a factor itself exceeds safe integer precision', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(`Total = 0
for I in 1 to 100
 Factor = 9007199254740991 + I
 if Factor * 2 greater 9007199254740991 * 2
  Total += 1
 end
end`));
        expect(runtime.variables.get('Total')).toBe(100n);
        expect(diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
});
it.each(operators)('retains exact %s products in ordinary scalar helpers', op => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(`fun A compare B C D\n return A * B ${op} C * D\nend`);
        const fn = runtime.variables.get('compare') as { call(args: bigint[]): unknown };
        diagnostics.run(() => {
            for (const [a, b, c, d] of cases) expect(fn.call([a, b, c, d])).toBe(compare(op, a * b, c * d));
        });
        expect(diagnostics.numberFunctions).toBeGreaterThan(0);
        expect(diagnostics.numberFunctionFallbacks).toBe(0);
    } finally { runtime.dispose(); }
});
it('preserves an ordinary stored wide product and mutations across its comparison', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.variables.set('Left', maximum);
        runtime.variables.set('Right', maximum - 2n);
        runtime.variables.set('Other', maximum - 1n);
        runtime.execute(`Product = 0
Total = 0
Values = array 0
for I in 1 to 100
 Values 0 += 1
 Product = Left * Right
 if Product less Other * Other
  Total += 1
 end
end`);
        expect(runtime.variables.get('Product')).toBe(maximum * (maximum - 2n));
        expect(runtime.variables.get('Total')).toBe(100n);
        expect(runtime.execute('Values 0')).toBe(100n);
    } finally { runtime.dispose(); }
});
