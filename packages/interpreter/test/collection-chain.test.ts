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
