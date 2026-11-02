import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, type RankArray } from '../src/index.js';
import { booleanCells, readArrayItem } from '../src/array-storage.js';
import { withInterrupt } from '../src/interrupt.js';

const size = 65539;
describe('stored boolean gathers', () => {
    it('gathers repeated irregular indices directly into a bitmap', () => {
        const runtime = new Interpreter(), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`use sequences
Bits = array true false true false false
Indices = (0 till ${size}) mod 5 copy
Result = Bits Indices`));
            const result = runtime.variables.get('Result');
            if (!result || !isRankArray(result)) throw new Error('expected array');
            expect(diagnostics.packedBooleanGathers).toBe(1);
            expect(diagnostics.packedBooleanGatherCells).toBe(size);
            expect(booleanCells(result)?.length).toBe(size);
            for (let i = 0; i < size; i++) expect(readArrayItem(result, i)).toBe(i % 5 === 0 || i % 5 === 2);
            runtime.execute('Bits 0 = false\nResult 1 = true');
            expect(readArrayItem(result, 0)).toBe(true);
            expect(readArrayItem(runtime.variables.get('Bits') as typeof result, 1)).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('retains a shaped integer selector and zero tail bits', () => {
        const runtime = new Interpreter();
        try {
            const result = runtime.execute(`use sequences
Bits = array false true false
Indices = ((0 till 65538) mod 3) reshape 2 32769
Bits Indices`);
            if (!result || !isRankArray(result)) throw new Error('expected array');
            expect(result.shape).toEqual([2, 32769]);
            expect(readArrayItem(result, 65537)).toBe(false);
            const packed = booleanCells(result)!;
            expect(packed.words[packed.words.length - 1] >>> 2).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('reports invalid indices before creating a result', () => {
        const runtime = new Interpreter();
        try {
            expect(() => runtime.execute(`use sequences
Bits = array true false
Indices = (0 till 65537) mod 2 copy
Indices 65536 = 2
Result = Bits Indices`)).toThrow(/out of bounds/);
            expect(runtime.variables.has('Result')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('follows changed selector revisions', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`use sequences
Bits = array true false
Indices = (0 till 65537) mod 2 copy
First = Bits Indices
Indices 65536 = 1
Second = Bits Indices`);
            expect(readArrayItem(runtime.variables.get('First') as RankArray, 65536)).toBe(true);
            expect(readArrayItem(runtime.variables.get('Second') as RankArray, 65536)).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('retains cooperative cancellation', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`use sequences
Bits = array true false
Indices = (0 till 65537) mod 2 copy`);
            const signal = new Int32Array(1); signal[0] = 1;
            expect(() => withInterrupt(signal, () => runtime.execute('Bits Indices'))).toThrow();
        } finally { runtime.dispose(); }
    });
});
