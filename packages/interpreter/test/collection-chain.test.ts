import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { run } from './support.js';

describe('collection consumer chains', () => {
    for (const chain of ['sort unique', 'unique sum']) {
        it.each(['array 3 1 3 2', 'array 3.5 1.5 3.5', 'array shape 0 fill 0',
            'array 9223372036854775808 1 9223372036854775808'])
        (`${chain} matches separate calls for %s`, input => {
            const [first, second] = chain.split(' ');
            const setup = `use sequences\nV = ${input}\n`;
            expect(run(setup + `V ${chain}`)).toBe(run(setup + `T = V ${first}\nT ${second}`));
        });
    }
});

it('selects smallest K with and without distinct and a sum terminal', () => {
    for (let seed = 0; seed < 20; seed++) {
        const input = Array.from({ length: 37 }, (_, i) => ((i * 17 + seed * 13) % 23) - 11).join(' ');
        for (const count of [0, 1, 3, 36, 100]) for (const unique of ['', 'unique ']) for (const sum of ['', ' sum']) {
            const setup = `use sequences\nV = array ${input}\n`;
            expect(run(setup + `V ${unique}sort take ${count}${sum}`)).toBe(run(setup
                + `U = V ${unique}sort\nT = U take ${count}\nT${sum}`));
        }
    }
});

it('uses bounded selection for sorted prefixes', () => {
    const runtime = new Interpreter(), diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute('use sequences\nV = array 3 1 3 2');
        expect(diagnostics.run(() => runtime.execute('V unique sort take 2 sum'))).toBe(3n);
        expect(diagnostics.numericSmallestSelections).toBe(1);
    } finally { runtime.dispose(); }
});

it('composes slices, arithmetic and native mask selection with distinct consumers', () => {
    for (const prefix of ['V drop 2', 'V take 4', 'V + 1', 'V filter Mask array']) {
        for (const terminal of ['sum', 'len']) {
            const setup = 'use sequences\nV = array 5 3 5 2 3 1\nMask = array true false true true false true\n';
            expect(run(setup + `(${prefix}) unique ${terminal}`)).toBe(
                run(setup + `T = ${prefix}\nU = T unique\nU ${terminal}`));
        }
    }
    const runtime = new Interpreter(), diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute('use sequences\nV = array 3 1 3 2\nMask = array true false true true');
        expect(diagnostics.run(() => runtime.execute('V filter Mask array unique sum'))).toBe(5n);
        expect(diagnostics.maskMaterializations).toBe(0);
        expect(diagnostics.numericUniqueSums).toBe(1);
    } finally { runtime.dispose(); }
});

it('keeps replaced functions, count side effects and invalid counts on ordinary paths', () => {
    expect(run('use sequences\nfun X custom = 99\nu = custom\nV = array 3 1 3\nV u sum')).toBe('99');
    for (const count of ['-1', '1.5']) {
        expect(() => run(`use sequences\nV = array 3 1 3\nV sort take ${count}`)).toThrow();
    }
});

it('does not bypass an opaque source when selecting a prefix', () => {
    const runtime = new Interpreter(), diagnostics = new RuntimeDiagnostics(), reads: number[] = [];
    try {
        runtime.execute('use sequences');
        runtime.variables.set('V', { kind: 'array', shape: [3], items: [],
            itemAt(index: number) { reads.push(index); return [3n, 1n, 2n][index]; } });
        expect(diagnostics.run(() => runtime.execute('V sort take 1 sum'))).toBe(1n);
        expect(diagnostics.numericSmallestSelections).toBe(0);
        expect(reads).toEqual([0, 1, 2]);
    } finally { runtime.dispose(); }
});

it('keeps integer sums exact above the safe Number range', () => {
    expect(run('use sequences\nV = array 9007199254740993 9007199254740992 9007199254740993\nV unique sum'))
        .toBe('18014398509481985');
    expect(run('use sequences\nV = array 9007199254740993 1 2\nV sort take 3 sum'))
        .toBe('9007199254740996');
});
