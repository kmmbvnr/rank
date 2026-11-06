import { prepareNumberTensor } from '../src/jit/tensor-number.js';
import type { TensorNode } from '../src/jit/tensor-ir.js';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { withDemandBudget, DemandBudgetExhausted } from '../src/interrupt.js';
import { typedArray } from '../src/array-storage.js';
function run(body: string, compilation: boolean) {
    const r = new Interpreter(() => {}, { compilation }), d = new RuntimeDiagnostics();
    try {
        let value: string | undefined, error: string | undefined;
        try { const answer = d.run(() => r.execute(`use numbers\nuse sequences\n${body}`));
            if (answer !== undefined) value = formatValue(answer); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { value, error, d };
    } finally { r.dispose(); }
}
function compare(body: string) {
    const a = run(body, true), b = run(body, false);
    expect({ value: a.value, error: a.error }).toEqual({ value: b.value, error: b.error });
    return a;
}
describe('native isqrt and integer tensor recipes', () => {
    it('fuses roots, boolean casts and extrema without intermediate cells', () => {
        const result = compare(`Input = 1 to 4096 array
Square' = Input * Input
Root' = Square isqrt
Hit' = Root equal Input
Exact' = Hit integer
Count' = (Root - 2) max 0
Alive' = (Count greater 0) integer
Terms' = Exact * Alive + Count
Terms sum`);
        expect(result.error).toBeUndefined();
        expect(result.d.numberTensors).toBeGreaterThan(0);
        expect(result.d.cellsComputed).toBe(0);
    });
    it.each(['min', 'max'])('keeps %s in a nested deferred graph', op => {
        const result = compare(`Input = 1 to 100 array
A' = Input * 2
B' = (A ${op} 20) + 1
Mask' = (B greater 5) integer
(B * Mask) sum`);
        expect(result.d.numberTensors).toBeGreaterThan(0);
        expect(result.d.cellsComputed).toBe(0);
    });
    it.each([
        'Input = array -1 0 1\nRoot\x27 = Input isqrt\nRoot copy',
        'Input = array 0 1 2 3 4 8 9 15 16\nRoot\x27 = Input isqrt\nRoot copy',
        'Input = array 9007199254740991 9007199254740992 9007199254740993\nRoot\x27 = Input isqrt\nRoot copy',
        'Input = array 10000000000000000000000000000000000000000\nRoot\x27 = Input isqrt\nRoot copy',
        'Input = array true false true\nMask\x27 = Input integer\nMask copy',
        'Input = array -1.9 0.0 1.9\nValues\x27 = Input integer\nValues copy',
        'Input = array "1" "-2"\nValues\x27 = Input integer\nValues copy',
        'Input = array "1" "bad"\nValues\x27 = Input integer\nValues copy',
        'Input = array shape 0 fill 0\nRoot\x27 = Input isqrt\nRoot copy',
        'Input = array 1 2 3\nGrid\x27 = Input reshape 3 1\nRoot\x27 = (Grid * Grid + (array 0 1)) isqrt\nRoot copy',
        'Input = array 1 2 3\nUnused\x27 = (Input - 4) isqrt\n7',
        'fun X isqrt\n return X + 10\nend\nInput = array 1 2\nRoot\x27 = Input isqrt\nRoot copy',
        'fun X integer\n return 7\nend\nInput = array 1 2\nValues\x27 = Input integer\nValues copy',
    ])('preserves exact fallback and demand: %s', body => { compare(body); });
    it('does not retain a range bound after a language write', () => {
        const result = compare(`Input = 1 to 100 array
Input 99 = 2147483647
Values' = Input * Input * Input
Values sum`);
        expect(result.error).toBeUndefined();
    });
    it('keeps range proofs exact for negative and reversed progressions', () => {
        compare(`Input = (100 to -100 by -1) array
Values' = (Input * Input) isqrt
(Values + Input) sum`);
    });
    it('replays unsafe range arithmetic before clipping the result', () => {
        compare(`Input = 94906260 to 94906275 array
Square' = Input * Input
Values' = (Square min 9007199254740991) - Input
Values sum`);
    });
    it('does not evaluate opaque input during recipe construction', () => {
        const r = new Interpreter(), reads: number[] = [];
        try {
            r.variables.set('Input', { kind: 'array', shape: [3], items: [], itemAt: i => {
                reads.push(i); if (i === 2) throw Error('bad cell'); return BigInt(i * i); } });
            r.execute("use numbers\nRoot' = Input isqrt");
            expect(reads).toEqual([]);
            expect(r.execute('Root 1')).toBe(1n);
            expect(() => r.execute('Root 2')).toThrow('bad cell');
        } finally { r.dispose(); }
    });
    it('retains observable demand budgets', () => {
        const r = new Interpreter();
        try {
            r.variables.set('Input', typedArray(new Int32Array(4096).fill(9)));
            r.execute("use numbers\nRoot' = Input isqrt");
            expect(() => withDemandBudget(1, () => r.execute('Root sum'))).toThrow(DemandBudgetExhausted);
        } finally { r.dispose(); }
    });
});

it('bounds preparation stays small for deeply unsafe arithmetic', () => {
    let root: TensorNode = { kind: 'input', value: typedArray(new Int32Array([2])) };
    const domains = new Map<TensorNode, readonly ['integer']>([[root, ['integer']]]);
    for (let i = 0; i < 64; i++) {
        root = { kind: 'binary', op: '*', left: root, right: root };
        domains.set(root, ['integer']);
    }
    expect(prepareNumberTensor(root, domains, 'sum', new Map(), () => true)).toBeTypeOf('function');
});
