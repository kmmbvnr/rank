import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type RankArray } from '../src/index.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { readArrayItem } from '../src/array-storage.js';

function execute(source: string, compilation: boolean) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(undefined, { compilation });
    try {
        const value = diagnostics.run(() => runtime.execute(source));
        return { value: value === undefined ? undefined : formatValue(value), diagnostics };
    } finally { runtime.dispose(); }
}

describe('native tensor completion', () => {
    it.each(['+', '-', '*', '/'])('compiles a deferred real outer %s at reshape completion', operator => {
        const source = `use sequences
A = array 1.0 2.0
B = array 2.0 4.0
Later' = (A B outer ${operator}) reshape 4
A = array 99.0
Saved = Later
Saved`;
        const reference = execute(source, false);
        const compiled = execute(source, true);
        expect(compiled.value).toBe(reference.value);
        expect(compiled.diagnostics.compiledTensors).toBeGreaterThan(0);
        expect(reference.diagnostics.compiledTensors).toBe(0);
        expect(compiled.diagnostics.typedUnpacks).toBe(0);
    });

    it('does not demand unused deferred expressions', () => {
        const result = execute(`use sequences
A = array 1.0 2.0
Unused' = (A (array 0.0) outer /) reshape 99
7`, true);
        expect(result.value).toBe('7');
        expect(result.diagnostics.compiledTensors).toBe(0);
    });

    it('keeps ordinary completion independent of later writes', () => {
        const source = `use sequences
A = array 1.0 2.0
Later' = A (array 2.0 4.0) outer *
Saved = Later
Saved 0 0 = 99.0
Later copy`;
        const reference = execute(source, false);
        const compiled = execute(source, true);
        expect(compiled.value).toBe('2 4 4 8');
        expect(compiled.value).toBe(reference.value);
        expect(compiled.diagnostics.compiledTensors).toBeGreaterThan(0);
    });

    it.each([false, true])('retains earlier stores when reshape fails (compilation=%s)', compilation => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            expect(() => runtime.execute(`use sequences
A = array 1.0 2.0
Later' = (A A outer +) reshape 3
Before = 7
Failed = Later
After = 9`)).toThrow(/reshape/);
            expect(runtime.variables.get('Before')).toBe(7n);
            expect(runtime.variables.has('Failed')).toBe(false);
            expect(runtime.variables.has('After')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it.each([false, true])('does not probe host cells or reorder their reads (compilation=%s)', compilation => {
        const reads: number[] = [];
        const host: RankArray = { kind: 'array', shape: [2], items: [],
            itemAt: index => { reads.push(index); return index + 1.0; } };
        const runtime = new Interpreter(undefined, { compilation });
        const d = new RuntimeDiagnostics();
        try {
            runtime.variables.set('Host', host);
            runtime.execute("use sequences\nLater' = Host (array 2.0) outer +");
            expect(reads).toEqual([]);
            const saved = d.run(() => runtime.execute('Saved = Later')) as RankArray;
            expect(reads).toEqual([0, 1]);
            expect([readArrayItem(saved, 0), readArrayItem(saved, 1)]).toEqual([3, 4]);
            expect(d.compiledTensors).toBe(0);
        } finally { runtime.dispose(); }
    });
});

describe.each([false, true])('packed first-where consumption (compilation=%s)', compilation => {
    it('reads an initial prefix without unpacking either boolean buffer', () => {
        const result = execute(`Bits = array shape 7000 fill false
Bits 0 = true
Miss = not Bits
Bits first index where Miss`, compilation);
        expect(result.value).toBe('1');
        expect(result.diagnostics.typedUnpackedCells).toBe(0);
    });

    it('does not read host cells beyond the first matching position', () => {
        const reads: string[] = [];
        const source: RankArray = { kind: 'array', shape: [4], items: [],
            itemAt: index => { reads.push(`source:${index}`); return BigInt(index); } };
        const mask: RankArray = { kind: 'array', shape: [4], items: [],
            itemAt: index => { reads.push(`mask:${index}`); return index === 1; } };
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.variables.set('Source', source);
            runtime.variables.set('Mask', mask);
            expect(runtime.execute('Source first index where Mask')).toBe(1n);
            expect(reads).toEqual(['mask:0', 'source:0', 'mask:0', 'source:1', 'mask:1']);
        } finally { runtime.dispose(); }
    });
});
