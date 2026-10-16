import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, createArraySnapshot, formatValue, type RankValue } from '../src/index.js';
import { native } from '../src/modules/shared.js';

const definition = `use sequences
Rows = array 0 1 2 3
fun Q safe
  Up = Q + Rows unique len
  if Up not equal 4
    return false
  end
  Down = Q - Rows unique len
  return Down equal 4
end`;

function run(code: string, compiled: boolean) {
    const runtime = new Interpreter(() => {}, { arrayFunctionCompilation: compiled });
    const diagnostics = new RuntimeDiagnostics();
    const value = diagnostics.run(() => formatValue(runtime.execute(code)!));
    return { runtime, diagnostics, value };
}

describe('integer distinct-count function fusion', () => {
    it.each(['array 1 3 0 2', 'array 0 1 2 3', 'array 2 0 3 1', 'array 0 3 1 2'])(
        'preserves both early-return and accepted branches for %s', input => {
            const code = `${definition}\n(${input}) safe`;
            const fused = run(code, true);
            expect(fused.value).toBe(run(code, false).value);
            expect(fused.diagnostics.compiledArrayFunctions).toBe(1);
        });

    it.each([-1, 0, 1, 2, 3, 4, 5])('compares exact distinct counts with target %i', target => {
        const code = `use sequences
fun Q predicate
  Count = Q unique len
  return Count equal ${target}
end
(array 3 1 3 2) predicate`;
        const fused = run(code, true);
        expect(fused.value).toBe(target === 3 ? 'true' : 'false');
        expect(fused.value).toBe(run(code, false).value);
        expect(fused.diagnostics.compiledArrayFunctions).toBe(1);
    });

    it('supports reversed comparisons, lengths, negative arithmetic and boolean combinations', () => {
        const code = `use sequences
fun Q predicate
  Shifted = Q * -2 + 5
  return ((Q len) equal (Shifted unique len)) and (0 not equal (Q unique len))
end
(array -3 0 4 7) predicate`;
        const fused = run(code, true);
        expect(fused.value).toBe('true');
        expect(fused.value).toBe(run(code, false).value);
        expect(fused.diagnostics.compiledArrayFunctions).toBe(1);
    });

    it('can return an actual distinct count instead of a predicate', () => {
        const code = 'use sequences\nfun Q distinct\nN = Q unique len\nreturn N + 10\nend\n(array 1 1 2) distinct';
        expect(run(code, true).value).toBe('12');
        expect(run(code, true).value).toBe(run(code, false).value);
    });

    it('preserves empty inputs and length-one broadcasting', () => {
        for (const input of ['array 1', 'array 1.5 3.5 0.5 2.5']) {
            const code = `${definition}\n(${input}) safe`;
            expect(run(code, true).value).toBe(run(code, false).value);
        }
        const empty = 'use sequences\nfun Q empty\nreturn (Q unique len) equal (Q len)\nend\n(0 till 0 array) empty';
        expect(run(empty, true).value).toBe(run(empty, false).value);
    });

    it('does not raise errors in unreachable assignments during preparation', () => {
        const code = `${definition.replace('Down = Q - Rows unique len', 'Bad = Q + (array 1 2)\nDown = Q - Rows unique len')}\n(array 3 2 1 0) safe`;
        expect(run(code, true).value).toBe('false');
        expect(run(code, true).value).toBe(run(code, false).value);
        expect(() => run(code.replace('array 3 2 1 0) safe', 'array 1 3 0 2) safe'), true)).toThrow(/shape mismatch/);
    });

    it('keeps host reads and their late errors on the ordinary path', () => {
        const outputs = [];
        for (const compiled of [false, true]) {
            const runtime = new Interpreter(() => {}, { arrayFunctionCompilation: compiled });
            runtime.execute(definition);
            const reads: number[] = [];
            runtime.variables.set('Host', { kind: 'array', shape: [4], get items(): RankValue[] { throw Error('forced'); },
                itemAt: i => { reads.push(i); if (i === 3) throw Error('late failure'); return BigInt(i); } });
            expect(() => runtime.execute('Host safe')).toThrow('late failure');
            outputs.push(reads);
        }
        expect(outputs[1]).toEqual(outputs[0]);
    });

    it('revalidates captured values and owned storage after mutation', () => {
        const { runtime } = run(`${definition}\n(array 1 3 0 2) safe`, true);
        runtime.execute('Rows = array 0 0 0 0');
        expect(runtime.execute('(array 0 1 2 3) safe')).toBe(true);
        const input = createArraySnapshot([0n, 1n, 2n, 3n]);
        runtime.variables.set('Input', input);
        expect(runtime.execute('Input safe')).toBe(true);
        input.items[3] = 'bad';
        expect(() => runtime.execute('Input safe')).toThrow();
    });

    it('fuses integer permutation rows without retaining mutable iterator storage', () => {
        const code = `${definition}\nuse algo\nSols = Rows permutations filter safe array\nSols`;
        const fused = run(code, true);
        expect(fused.value).toBe('1 3 0 2 2 0 3 1');
        expect(fused.value).toBe(run(code, false).value);
        expect(fused.diagnostics.compiledArrayFunctions).toBe(24);
    });

    it.each(['unique', 'len'])('respects host replacements of %s', name => {
        const outputs = [];
        for (const compiled of [false, true]) {
            const runtime = new Interpreter(() => {}, { arrayFunctionCompilation: compiled });
            runtime.execute(definition);
            let calls = 0;
            runtime.variables.set(name, native(name, 1, () => { calls++; return name === 'len' ? 4n : createArraySnapshot([0n]); }));
            const diagnostics = new RuntimeDiagnostics();
            const result = diagnostics.run(() => runtime.execute('(array 0 1 2 3) safe'));
            expect(diagnostics.compiledArrayFunctions).toBe(0);
            outputs.push({ result, calls });
        }
        expect(outputs[1]).toEqual(outputs[0]);
    });
});
