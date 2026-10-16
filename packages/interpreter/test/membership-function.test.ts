import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, createArraySnapshot, formatValue, type RankValue } from '../src/index.js';
import { prepareArrayRead, readArrayItem } from '../src/array-storage.js';
import { isRankArray } from '../src/value.js';

const source = `use sequences
fun Q mask
  A = Q + Dy
  Blocked = concat Q A (Q - Dy)
  return Cols not in Blocked
end
Dy = array 1 2
Cols = 0 till 6 array
Q = array 1 3
Q mask`;

function execute(code: string, compiled: boolean) {
    const runtime = new Interpreter(() => {}, { arrayFunctionCompilation: compiled });
    const diagnostics = new RuntimeDiagnostics();
    const result = diagnostics.run(() => {
        const value = runtime.execute(code);
        return value === undefined ? undefined : formatValue(value);
    });
    return { runtime, diagnostics, result };
}

describe('fused integer membership functions', () => {
    it('fuses several private vector expressions and concat without changing the mask', () => {
        const fused = execute(source, true);
        expect(fused.result).toBe('false false false false true false');
        expect(fused.result).toBe(execute(source, false).result);
        expect(fused.diagnostics.compiledArrayFunctions).toBe(1);
    });

    it.each(['in', 'not in'])('handles scalar arithmetic, nested concat, negatives and %s', op => {
        const code = `use sequences
fun Q mask
  A = Q * 2 - 1
  B = concat (concat Q A) (Q + 3)
  return Cols ${op} B
end
Cols = -5 to 10 array
Q = array -2 0 3
Q mask`;
        const fused = execute(code, true);
        expect(fused.result).toBe(execute(code, false).result);
        expect(fused.diagnostics.compiledArrayFunctions).toBe(1);
    });

    it('keeps unused assignments and shape errors on the reference path', () => {
        const code = source.replace('A = Q + Dy', 'Unused = Q + (array 1 2 3)\n  A = Q + Dy');
        for (const compiled of [true, false]) expect(() => execute(code, compiled)).toThrow(/shape mismatch/);
    });

    it('falls back for broadcasting and noninteger values', () => {
        for (const code of [source.replace('Dy = array 1 2', 'Dy = array 1'), source.replace('Q = array 1 3', 'Q = array 1.5 3.5')]) {
            const fused = execute(code, true);
            expect(fused.result).toBe(execute(code, false).result);
            expect(fused.diagnostics.compiledArrayFunctions).toBe(0);
        }
    });

    it('does not probe or bypass host cell readers', () => {
        const outputs = [];
        for (const compiled of [false, true]) {
            let reads = 0;
            const runtime = new Interpreter(() => {}, { arrayFunctionCompilation: compiled });
            runtime.variables.set('Host', { kind: 'array', shape: [2], get items(): RankValue[] { throw Error('forced'); },
                itemAt: index => { reads++; return BigInt(index + 1); } });
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => runtime.execute(source.replace('Q = array 1 3', 'Q = Host')));
            outputs.push({ result: formatValue(result!), reads });
            expect(diagnostics.compiledArrayFunctions).toBe(0);
        }
        expect(outputs[1]).toEqual(outputs[0]);
    });

    it('rebinds captures and rechecks storage types after host mutations', () => {
        const { runtime } = execute(source, true);
        const q = createArraySnapshot([1n, 3n]);
        runtime.variables.set('Input', q);
        expect(formatValue(runtime.execute('Input mask')!)).toBe('false false false false true false');
        runtime.execute('Dy = array 2 3');
        expect(formatValue(runtime.execute('Input mask')!)).toBe('false false true false true true');
        q.items[0] = 'bad';
        expect(() => runtime.execute('Input mask')).toThrow();
    });

    it('keeps captured writes and effects on the reference path', () => {
        const code = `use sequences
fun factory
  Blocked = array 0
  fun Q mask
    Blocked = concat Q Q
    return Cols in Blocked
  end
  return (array 1) mask
end
Cols = array 1 2
factory`;
        const fused = execute(code, true);
        expect(fused.result).toBe(execute(code, false).result);
        expect(fused.diagnostics.compiledArrayFunctions).toBe(0);
    });

    it('fuses trusted row/gather views and preserves ranked masks', () => {
        const code = `use sequences
Cols = 0 till 4 array
Dy = array 1 2
fun Q mask
  Blocked = concat Q (Q + Dy) (Q - Dy)
  return Cols not in Blocked
end
M = (array 1 3 0 2 2 0 3 1) reshape 2 4
M = M copy
P = M # (0 till 2)
R = P mask rank 1
R reshape 8`;
        const fused = execute(code, true);
        expect(fused.result).toBe(execute(code, false).result);
        expect(fused.diagnostics.rankedArrayBatches).toBeGreaterThan(0);
    });

    it('keeps cached rows but revalidates captures between prepared reads', () => {
        const runtime = new Interpreter(() => {});
        runtime.execute(source.slice(0, source.lastIndexOf('Q mask')));
        runtime.execute('M = (array 1 3 1 3 1 3) reshape 3 2\nM = M copy\nR = M mask rank 1');
        const value = runtime.variables.get('R')!;
        expect(isRankArray(value)).toBe(true);
        if (!isRankArray(value)) return;
        expect(value.shape).toEqual([3, 6]);
        const read = prepareArrayRead(value)!;
        expect(read).toBeTypeOf('function');
        const first = Array.from({ length: 6 }, (_, i) => read(i));
        const second = Array.from({ length: 6 }, (_, i) => read(6 + i));
        expect(second).toEqual(first);
        runtime.execute('Dy = array 2 3');
        const third = Array.from({ length: 6 }, (_, i) => read(12 + i));
        expect(third).toEqual([false, false, true, false, true, true]);
        expect(Array.from({ length: 6 }, (_, i) => readArrayItem(value, 6 + i))).toEqual(second);
    });

    it('can disable ranked preparation while retaining function fusion', () => {
        const code = source.replace('\nQ mask', '\nM = (array 1 3 2 0 0 2) reshape 3 2\nM = M copy\nR = M mask rank 1\nR reshape 18');
        const runtime = new Interpreter(() => {}, { rankedArrayCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        const result = diagnostics.run(() => runtime.execute(code));
        expect(formatValue(result!)).toBe(execute(code, false).result);
        expect(diagnostics.compiledArrayFunctions).toBeGreaterThan(0);
        expect(diagnostics.rankedArrayBatches).toBe(0);
    });

    it.each(['1', '2 0'])('preserves nonleading frame axes %s', axes => {
        const shape = axes === '1' ? '2 3' : '2 2 3';
        const size = axes === '1' ? 18 : 36;
        const code = source.replace('\nQ mask', `\nM = (0 till ${size / 3} array) reshape ${shape}
M = M copy
R = M mask axis ${axes} rank 1
R reshape ${size}`);
        const fused = execute(code, true);
        expect(fused.result).toBe(execute(code, false).result);
        expect(fused.diagnostics.rankedArrayBatches).toBeGreaterThan(0);
    });

    it('declines a prepared batch after its owned source is mutated', () => {
        const runtime = new Interpreter(() => {});
        runtime.execute(source.slice(0, source.lastIndexOf('Q mask')));
        const input = createArraySnapshot([1n, 3n, 1n, 3n, 1n, 3n], [3, 2]);
        runtime.variables.set('Input', input);
        runtime.execute('R = Input mask rank 1');
        const value = runtime.variables.get('R')!;
        if (!isRankArray(value)) throw Error('expected ranked mask');
        const read = prepareArrayRead(value)!;
        expect(read).toBeTypeOf('function');
        read(6);
        input.items[4] = 'bad';
        expect(() => read(12)).toThrow();
        expect(read(6)).toBe(false);
    });

    it('preserves host matrix read order when ranked preparation is unavailable', () => {
        const outputs = [];
        for (const compiled of [false, true]) {
            const runtime = new Interpreter(() => {}, { arrayFunctionCompilation: compiled });
            runtime.execute(source.slice(0, source.lastIndexOf('Q mask')));
            const reads: number[] = [];
            runtime.variables.set('Host', { kind: 'array', shape: [3, 2], items: [], itemAt: i => {
                reads.push(i);
                return [1n, 3n, 2n, 0n, 0n, 2n][i];
            } });
            const diagnostics = new RuntimeDiagnostics();
            const value = diagnostics.run(() => {
                runtime.execute('R = Host mask rank 1');
                const result = runtime.variables.get('R')!;
                if (!isRankArray(result)) throw Error('expected ranked mask');
                return [...result.items];
            });
            outputs.push({ reads, value });
            expect(diagnostics.rankedArrayBatches).toBe(0);
        }
        expect(outputs[1]).toEqual(outputs[0]);
    });
});
