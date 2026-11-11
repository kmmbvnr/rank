import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, parse, type RankArray } from '../src/index.js';

import { typedArray, arrayValues } from '../src/array-storage.js';
import { compileArrayRegion } from '../src/jit/array-region.js';
import { withDemandBudget, DemandBudgetExhausted, withInterrupt, InterruptedError } from '../src/interrupt.js';

function execute(source: string, fusion: boolean) {
    const r = new Interpreter(() => {}, { tensorFusion: fusion, numberLoopCompilation: false }), d = new RuntimeDiagnostics();
    try {
        return d.run(() => {
            let error: string | undefined, result: string | undefined;
            try { result = formatValue(r.execute(source)!); }
            catch (e) { error = (e as Error).message; }
            const state = ['A', 'Alias', 'Done'].flatMap(name => r.variables.has(name)
                ? [[name, formatValue(r.variables.get(name)!)]] : []);
            return { result, error, state, fused: d.fusedArrayRegions, cells: d.fusedArrayRegionCells };
        });
    } finally { r.dispose(); }
}
function compare(source: string, fused = true) {
    const actual = execute(source, true), reference = execute(source, false);
    expect({ ...actual, fused: 0, cells: 0 }).toEqual({ ...reference, fused: 0, cells: 0 });
    if (fused) expect(actual.fused).toBeGreaterThan(0);
    return actual;
}
const head = 'use sequences\nA = array 2 4 6 8\nB = array 10 20 30 40\n';
const chain = `for P in 1 to 3
 Ix = 0 to 3
 Pi = Ix + 1
 Mask = Pi at most 2
 Va = A Ix
 Vb = B Ix
 Chosen = Mask choose Va Vb
 A Ix = (A Ix + Chosen) mod 1000000007
end
A`;

describe('fused integer array regions', () => {
    it('fuses gather/choose/arithmetic into a snapshot update', () => {
        compare(head + 'Alias = A\n' + chain);
    });
    it.each(['+=', '-=', '*='])('applies compound %s exactly once', op => {
        compare(head + chain.replace('A Ix = (A Ix + Chosen) mod 1000000007', `A Ix ${op} Chosen`));
    });
    it('widens output beyond Int32 and reads safe Int64 inputs', () => {
        compare(head.replace('2 4 6 8', '3000000000 4000000000 5000000000 6000000000')
            + chain.replace(' mod 1000000007', ''));
    });
    it('broadcasts scalar and length-one choose branches in the final frame', () => {
        compare(head + chain.replace('Va = A Ix', 'Va = 7'));
        compare(head.replace('10 20 30 40', '9') + chain.replace('Vb = B Ix', 'Vb = B'));
    });
    it('does not read unsafe integers from the unselected choose branch', () => {
        compare(head.replace('10 20 30 40', '9007199254740993 9007199254740995 9007199254740997 9007199254740999')
            + chain.replace('Pi at most 2', 'Pi greater 0'));
    });
    it.each([-3, -1, 1, 2, 5, 11, 97])('matches signed arithmetic modulo %s', modulus => {
        for (let n = 2; n <= 10; n++) {
            const a = Array.from({ length: n }, (_, i) => (i * 13 + n * 7) % 31 - 15);
            const b = a.map((x, i) => x * 7 - i * 3);
            compare(`use sequences\nA = array ${a.join(' ')}\nB = array ${b.join(' ')}\n`
                + chain.split('0 to 3').join(`0 to ${n - 1}`).replace('1000000007', String(modulus)));
        }
    });
    it('keeps all reads before overlapping destination writes', () => {
        compare(`use sequences
A = array 1 2 3 4 5 6
Alias = A
for P in 1 to 2
 Ix = 0 to 4
 Jx = Ix + 1
 V = A Ix
 A Jx = V * 2
end
A`);
    });
    it('supports reverse source and destination slices', () => {
        compare(`use sequences
A = array 1 2 3 4 5
for P in 1 to 2
 Ix = 4 to 1 by -1
 Jx = Ix - 1
 V = A Jx
 A Ix = V + 7
end
A`);
    });
    it('declines overflow before changing the destination', () => {
        compare(head + chain.replace('A Ix + Chosen', 'A Ix * 9007199254740991'), false);
    });
    it('replays late precision overflow without committing the private prefix', () => {
        compare(head.replace('2 4 6 8', '0 1 1 2') + 'Alias = A\n'
            + chain.replace('A Ix + Chosen', 'A Ix * 9007199254740991'), false);
    });
    it('polls inside the fused kernel and leaves partially computed output private', () => {
        const program = parse('A = array shape 20000 fill 1\nIx = 0 to 19999\nV = A Ix\nW = V + 1\nA Ix = W\nA');
        const region = compileArrayRegion(program.statements, 1)!;
        expect(region).toBeDefined();
        const source = typedArray(new Int32Array(20000).fill(1), [20000]);
        const values = region.inputs.map(() => source);
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => region.run(values))).toThrow(InterruptedError);
        expect(() => withDemandBudget(5000, () => region.run(values))).toThrow(DemandBudgetExhausted);
        expect([...arrayValues(source)].every(x => x === 1n)).toBe(true);
        const result = region.run(values)!;
        expect([...arrayValues(result.value)].every(x => x === 2n)).toBe(true);
    });
    it('declines untracked array getters without reading them', () => {
        const program = parse('A = array 1 2\nIx = 0 to 1\nV = A Ix\nW = V + 1\nA Ix = W\nA');
        const region = compileArrayRegion(program.statements, 1)!;
        let reads = 0;
        const source = { kind: 'array', shape: [2], get items() { reads++; return [1n, 2n]; } } as RankArray;
        expect(region.run(region.inputs.map(() => source))).toBeUndefined();
        expect(reads).toBe(0);
    });
    it.each([
        ['0 to 4', '0 to 3', '1000000007'],
        ['-1 to 2', '0 to 3', '1000000007'],
        ['0 to 3', '0 to 3', '0'],
    ])('replays invalid ranges or divisors in their original order (%s)', (range, ignored, modulus) => {
        compare(head + 'Done = 0\n' + chain.replace('0 to 3', range)
            .replace('1000000007', modulus).replace(' Ix =', ' Done += 1\n Ix ='), false);
    });
    it('does not suppress errors in an unselected named gather', () => {
        const actual = compare(head + chain.replace('B Ix', 'B (Ix + 1)').replace('Pi at most 2', 'Pi greater 0'), false);
        expect(actual.error).toContain('out of bounds');
    });
    it('keeps unrelated failing assignments rather than eliminating them', () => {
        const actual = compare(head + chain.replace(' Pi =', ' Unused = 1 // 0\n Pi ='), false);
        expect(actual.error).toContain('division by zero');
    });
    it('retains temporaries that have later readers or pre-existing bindings', () => {
        compare(head + chain.replace(' A Ix =', ' A Ix =').replace('\nend\nA', '\n Done = Chosen sum\nend\nA'), false);
        compare(head + 'Chosen = array 0 0 0 0\n' + chain, false);
    });
    it('retains later writes and the type contracts of temporary bindings', () => {
        const result = compare(head + chain.replace('\nend\nA', '\n Chosen = 7\nend\nA'), false);
        expect(result.error).toContain('cannot receive');
        compare(head + chain.replace('\nend\nA', '\n Mask (0 to 1) = false\nend\nA'), false);
    });
    it('keeps duplicate selectors on the ordinary snapshot path', () => {
        compare(head + chain.replace('A Ix =', 'A (Ix * 0) ='), false);
    });
    it('leaves empty ranges on the ordinary path', () => {
        compare(head + chain.split('0 to 3').join('1 to 0'), false);
    });
    it('preserves the Euler 642 answer with fused kernels in both loops', () => {
        const source = readFileSync(new URL('../../../demos/euler/642_largestprimefactors.ra', import.meta.url), 'utf8')
            .replace('N integer = 201820182018', 'N integer = 10000');
        const result = compare(source);
        expect(result.result).toBe('10118280');
        expect(result.fused).toBeGreaterThan(25);
    });
});
