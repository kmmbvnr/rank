import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, type RankArray } from '../src/index.js';
import { applySelectors } from '../src/value-selection.js';
import { prepareStoredScalarView } from '../src/integer-view.js';
import { arrayRange } from '../src/range-plan.js';
import { typedArray } from '../src/array-storage.js';

for (const compilation of [false, true]) describe(`contiguous index arrays (compilation=${compilation})`, () => {
    const session = () => new Interpreter(undefined, { compilation });
    it('preserves linear addressing after materializing an integer range', () => {
        const r = session();
        try {
            r.execute('use sequences\nA = 1 to 10000 array\nIx = 100 till 5100 array');
            const source = r.variables.get('A') as RankArray;
            const selected = applySelectors([source, r.variables.get('Ix')!]) as RankArray;
            const view = prepareStoredScalarView(selected, true)!;
            expect(view.items).toBe(prepareStoredScalarView(source, true)!.items);
            expect(view.linear).toEqual({ offset: 100, stride: 1 });
            expect(view.read(4999)).toBe(5100n);
        } finally { r.dispose(); }
    });

    it('consumes inline range selectors without building index cells', () => {
        const r = session(), diagnostics = new RuntimeDiagnostics();
        try {
            r.execute('use sequences\nA = 1 to 10000 array');
            expect(diagnostics.run(() => r.execute('S = A (100 till 5100 array)\nS sum'))).toBe(13002500n);
            expect(diagnostics.rangeSelectorViews).toBe(1);
        } finally { r.dispose(); }
    });

    it('evaluates a range endpoint effect once and keeps infinite-array errors', () => {
        const output: string[] = [];
        const r = new Interpreter(value => output.push(value), { compilation });
        try {
            r.execute(`use sequences
use io
fun bound
  99 print
  return 3
end
A = 10 to 19 array
S = A (0 till bound array)`);
            expect(output).toEqual(['99']);
            expect(r.execute('S sum')).toBe(33n);
            expect(() => r.execute('A (0 to # array)')).toThrow(/infinite/);
        } finally { r.dispose(); }
    });

    it('materializes an unproved bounded source once before selecting', () => {
        const r = session();
        try {
            r.execute('use sequences\nA = 10 to 19 array\nIx\' = 0 till 3');
            const range = r.variables.get('Ix') as { plan: { iterate(): IterableIterator<bigint> } };
            let calls = 0;
            range.plan.iterate = function* () { calls++; yield 2n; yield 0n; };
            expect(formatValue(r.execute('A (Ix till 3 array)')!)).toBe('12 10');
            expect(calls).toBe(1);
        } finally { r.dispose(); }
    });

    it.each(['Ix 1 = 4', 'Ix 1 += 1'])('invalidates the range proof after %s', write => {
        const r = session();
        try {
            r.execute('use sequences\nA = 10 to 19 array\nIx = 1 till 4 array');
            expect(arrayRange(r.variables.get('Ix') as RankArray)).toBeDefined();
            r.execute(write);
            expect(formatValue(r.execute('A Ix')!)).toBe(write.includes('+=') ? '11 13 13' : '11 14 13');
        } finally { r.dispose(); }
    });

    it('invalidates a proof after a host write or replacement reader', () => {
        const r = session();
        try {
            r.execute('use sequences\nA = 10 to 19 array\nIx = 1 till 4 array');
            const indices = r.variables.get('Ix') as RankArray;
            indices.items[0] = 4n;
            expect(arrayRange(indices)).toBeUndefined();
            expect(formatValue(r.execute('A Ix')!)).toBe('14 12 13');
            r.execute('Ix = 1 till 4 array');
            const replacement = r.variables.get('Ix') as RankArray;
            Object.defineProperty(replacement, 'itemAt', { value: () => 0n });
            expect(arrayRange(replacement)).toBeUndefined();
        } finally { r.dispose(); }
    });

    it.each([
        ['0 till 0 array', ''], ['4 to 0 by -2 array', '14 12 10'],
        ['0 till 10 by 3 array', '10 13 16 19'],
    ])('keeps the values and shape of %s', (selector, result) => {
        const r = session();
        try {
            r.execute('use sequences\nA = 10 to 19 array');
            expect(formatValue(r.execute(`A (${selector})`)!)).toBe(result);
        } finally { r.dispose(); }
    });

    it.each(['-1 till 2 array', '9 to 10 array', '11 to 9 by -1 array'])('checks bounds for %s', selector => {
        const r = session();
        try {
            r.execute('use sequences\nA = 10 to 19 array');
            expect(() => r.execute(`A (${selector})`)).toThrow(/nonnegative|out of bounds/);
        } finally { r.dispose(); }
    });
});

for (const compilation of [false, true]) describe(`completed numeric slice views (compilation=${compilation})`, () => {
    const session = () => new Interpreter(undefined, { compilation });
    const buffer = (r: Interpreter, name: string) => {
        const view = prepareStoredScalarView(r.variables.get(name)!, true)!;
        return (view.compact ?? view.items as BigInt64Array).buffer;
    };

    it('binds two contiguous slices over the original buffer', () => {
        const r = session();
        try {
            r.execute('use sequences\nA = 1 to 10000 array\nXs = A (0 till 5000 array)\nYs = A (5000 till 10000 array)');
            expect(buffer(r, 'Xs')).toBe(buffer(r, 'A'));
            expect(buffer(r, 'Ys')).toBe(buffer(r, 'A'));
            expect(r.execute('(Xs * Ys) sum')).toBe(104191667500n);
            r.execute('Nested = Ys (10 till 20 array)\nReshaped = Ys reshape 50 100');
            expect(buffer(r, 'Nested')).toBe(buffer(r, 'A'));
            expect(r.execute('Nested sum')).toBe(50155n);
            r.execute('A 5010 = 99');
            expect(r.execute('Nested 0')).toBe(5011n);
            expect(r.execute('Ys 10')).toBe(5011n);
            expect(r.execute('Reshaped 0 10')).toBe(5011n);
        } finally { r.dispose(); }
    });

    it.each(['int64', 'real'] as const)('shares %s storage and protects nested slice writes', kind => {
        const r = session();
        try {
            const cells = kind === 'int64' ? BigInt64Array.from({ length: 10000 }, (_, i) => 2n ** 40n + BigInt(i))
                : Float64Array.from({ length: 10000 }, (_, i) => i + 0.25);
            r.variables.set('A', typedArray(cells, [100, 100]));
            r.execute('use sequences\nS = A (10 till 20 array) #\nT = S (1 till 2 array) #');
            expect(buffer(r, 'S')).toBe(cells.buffer);
            expect(buffer(r, 'T')).toBe(cells.buffer);
            const first = kind === 'int64' ? 2n ** 40n + 1100n : 1100.25;
            expect(r.execute('T 0 0')).toBe(first);
            r.execute(`T 0 0 = ${kind === 'int64' ? '99' : '99.0'}`);
            expect(r.execute('S 1 0')).toBe(first);
            expect(r.execute('A 11 0')).toBe(first);
        } finally { r.dispose(); }
    });

    it('keeps disjoint prefix and suffix writes in the source buffer', () => {
        const r = session(), diagnostics = new RuntimeDiagnostics();
        try {
            r.execute('use sequences\nA = 1 to 10000 array\nS = A (100 till 200 array)');
            const source = r.variables.get('A'), original = buffer(r, 'A');
            diagnostics.run(() => r.execute('A 99 = 99\nA 200 = 99'));
            expect(buffer(r, 'A')).toBe(original);
            expect(r.variables.get('A')).toBe(source);
            expect(diagnostics.cowCopiedCells).toBe(0);
            expect(r.execute('S sum')).toBe(15050n);
            r.execute('A 99 = 2 ** 40');
            expect(buffer(r, 'A')).not.toBe(original);
            r.execute('A 100 = 77');
            expect(r.execute('S 0')).toBe(101n);
            expect(r.execute('A 100')).toBe(77n);
        } finally { r.dispose(); }
    });

    it('protects whole-value aliases even when a write misses every slice', () => {
        const r = session();
        try {
            r.execute('use sequences\nA = 1 to 10000 array\nS = A (100 till 200 array)\nAlias = A\nA 0 = 99');
            expect(r.execute('Alias 0')).toBe(1n);
            expect(r.execute('A 0')).toBe(99n);
            expect(r.execute('S 0')).toBe(101n);
        } finally { r.dispose(); }
    });

    it('does not hoist reads across a source write inside a loop', () => {
        const r = session();
        try {
            expect(r.execute(`use sequences
A = array shape 10000 fill 0
S = array shape 0 fill 0
Total = 0
for I in 1 to 10
 S = A (0 till I array)
 A 0 = I
 Total += S 0
end
Total`)).toBe(45n);
            expect(r.execute('S 0')).toBe(9n);
        } finally { r.dispose(); }
    });

    it('detaches source and slice writes, including compiled loops and aliases', () => {
        const r = session();
        try {
            r.execute('use sequences\nA = 1 to 10000 array\nS = A (100 till 5100 array)\nT = S');
            r.execute('for I in 100 to 102\n A I = 99\nend');
            expect(r.execute('S 0')).toBe(101n);
            expect(r.execute('T 1')).toBe(102n);
            r.execute('S 0 = 2 ** 100');
            expect(r.execute('T 0')).toBe(101n);
            expect(r.execute('A 100')).toBe(99n);
            expect(r.execute('S 0')).toBe(2n ** 100n);
        } finally { r.dispose(); }
    });

    it('isolates public host writes through both items facades', () => {
        const r = session();
        try {
            r.execute('use sequences\nA = 1 to 10000 array\nS = A (100 till 5100 array)');
            (r.variables.get('A') as RankArray).items[100] = 99n;
            expect(r.execute('S 0')).toBe(101n);
            (r.variables.get('S') as RankArray).items[1] = 77n;
            expect(r.execute('A 101')).toBe(102n);
            expect(r.execute('S 1')).toBe(77n);
        } finally { r.dispose(); }
    });

    it('keeps explicit copy writable and independent of source writes', () => {
        const r = session();
        try {
            r.execute('use sequences\nA = 1 to 10000 array\nS = (A (100 till 5100 array)) copy');
            expect(r.execute('S sum')).toBe(13002500n);
            r.execute('S 0 = 99\nA 101 = 77');
            expect(r.execute('A 100')).toBe(101n);
            expect(r.execute('S 1')).toBe(102n);
        } finally { r.dispose(); }
    });
});

// Exercise the unchanged programs and their checked-in answer fixtures only.
it.each(['552_chineseleftovers2', '553_powersetsofpowersets', '559_permutedmatrices'])(
    'preserves Euler %s answers', id => {
        const directory = new URL('../../../demos/euler/', import.meta.url);
        const r = new Interpreter(() => {}, { loadModule: specifier => {
            const url = new URL(`${specifier}.ra`, directory);
            return { id: url.pathname, source: readFileSync(url, 'utf8') };
        } });
        try {
            r.execute(readFileSync(new URL(`${id}_test.ra`, directory), 'utf8'));
            expect(r.testResults).toHaveLength(1);
            for (const result of r.testResults) expect(result.error ?? result.passed).toBe(true);
        } finally { r.dispose(); }
    });
