import { describe, expect, it } from 'vitest';
import { demandValue } from '../src/plan.js';
import { Interpreter, formatValue, MISSING, createArraySnapshot, type RankSequence, type RankValue, parse } from '../src/index.js';

import { isFunctionStatement } from '@arrrank/language';
import { compileTensorKernel } from '../src/tensor-kernel.js';

const program = `use sequences
use bits
fun Cipher Weights Key Slots score
  KeyStream = Key Slots
  Plain = Cipher bxor KeyStream
  Score = Weights Plain sum
  return Score
end
Cipher = array 4 5 6 7 8 9
Weights = (0 till 32) copy
Key = array 1 2 3
Slots = (0 till 6) mod 3
Cipher Weights Key Slots score`;

function run(source: string, tensorFusion: boolean) {
    let kernels = 0;
    const compiled: string[] = [], output: string[] = [];
    const runtime = new Interpreter(line => output.push(line), {
        tensorFusion, onTensorKernelExecuted: () => kernels++, onTensorKernelCompiled: code => compiled.push(code),
    });
    try { return { value: formatValue(runtime.execute(source)!), output, kernels, compiled }; }
    catch (error) { return { error: String(error), output, kernels, compiled }; }
    finally { runtime.dispose(); }
}
function compare(source: string) {
    const reference = run(source, false), actual = run(source, true);
    expect({ ...actual, kernels: 0, compiled: [] }).toEqual(reference);
    return actual;
}

describe('completed gather arithmetic', () => {
    const source = `use sequences
W = array 1 2 3 4
Pv = array 7 11 13
Ix = array 2 0 1 2
Va = W * Pv Ix mod 17
Va`;

    it('fuses an ordinary gather/multiply/mod assignment before the next statement', () => {
        const actual = compare(source);
        expect(actual.value).toBe('13 14 16 1');
        expect(actual.kernels).toBe(1);
        expect(actual.compiled[0]).toContain('new IntegerCells(size)');
    });

    it.each(['array 2 0 1 -1', 'array 2 0 1 3', 'array 2 0 1 9007199254740993', 'array 2.0 0.0 1.0 2.0'])
    ('keeps selector failures for %s', indices => {
        expect(compare(source.replace('array 2 0 1 2', indices))).toHaveProperty('error');
    });

    it('retains escaped results and input snapshots across subsequent writes', () => {
        const actual = compare(source + '\nAlias = Va\nPv 0 = 99\nVa 0 = 3\narray Alias Va');
        expect(actual).not.toHaveProperty('error');
        expect(actual.value).toContain('13 14 16 1');
        expect(actual.value).toContain('3 14 16 1');
    });

    it('preserves empty-domain arithmetic failures', () => {
        const empty = source.replace('array 1 2 3 4', 'array shape 0 fill 0')
            .replace('array 2 0 1 2', 'array shape 0 fill 0');
        expect(compare(empty)).toMatchObject({ value: '' });
        expect(compare(empty.replace('mod 17', 'mod (1 // 0)'))).toHaveProperty('error');
    });

    it.each([
        ['array 7 11 13', 'array 7 .NA 13'],
        ['array 1 2 3 4', 'array 1 .NA 3 4'],
    ])('keeps missing-value propagation for %s', (from, to) => {
        expect(compare(source.replace(from, to))).toHaveProperty('value');
    });

    it('retains missing-index errors', () => {
        expect(compare(source.replace('array 2 0 1 2', 'array 2 .NA 1 2'))).toHaveProperty('error');
    });

    it('retains shape errors before publishing an output', () => {
        expect(compare(source.replace('array 1 2 3 4', 'array 1 2'))).toHaveProperty('error');
    });
});

describe('indirect gather bitwise reduction fusion', () => {
    it.each(['(0 till 6) mod 3', '((0 till 6) mod 3) copy', 'array 0 1 2 0 1 2', '(-3 till 3) mod 3'])('fuses selectors %s', slots => {
        const actual = compare(program.replace('(0 till 6) mod 3', slots));
        expect(actual.value).toBe(String([4, 5, 6, 7, 8, 9].reduce((sum, value, i) => sum + (value ^ [1, 2, 3][i % 3]), 0)));
        expect(actual.kernels).toBe(1);
        expect(actual.compiled).toHaveLength(1);
        expect(actual.compiled[0]).not.toContain('new Array');
        expect(actual.compiled[0].match(/for \(/g)).toHaveLength(1);
    });
    it.each(['band', 'bor'])('preserves %s integer semantics', op => {
        expect(compare(program.replace('bxor', op)).kernels).toBe(1);
    });
    it.each([
        ['array 4', '(0 till 6) mod 3'],
        ['array 4 5 6 7 8 9', 'array 1'],
        ['array shape 0 fill 0', 'array 1'],
        ['array 4', '0 till 0'],
    ])('broadcasts the selector frame, not the lookup table (%s, %s)', (cipher, slots) => {
        expect(compare(program.replace('array 4 5 6 7 8 9', cipher).replace('(0 till 6) mod 3', slots)).kernels).toBe(1);
    });
    it('retains arbitrary-width signed XOR', () => {
        const source = program.replace('array 4 5 6 7 8 9', 'array 9007199254740993 -9007199254740993')
            .replace('array 1 2 3', 'array 9007199254740992 -9007199254740994')
            .replace('(0 till 6) mod 3', '0 till 2');
        expect(compare(source)).toMatchObject({ value: '2', kernels: 1 });
    });
    it.each([
        ['array 1 2 3', 'array 1.5 2.5 3.5'],
        ['(0 till 6) mod 3', 'array 0 1 2 0 1 9'],
        ['(0 till 6) mod 3', 'array 0 1 2 0 1 -1'],
        ['(0 till 6) mod 3', '(0 till 6) mod 0'],
        ['array 4 5 6 7 8 9', 'array 4 5'],
        ['(0 till 32) copy', '(0 till 2) copy'],
    ])('preserves reference failures for %s → %s', (from, to) => {
        expect(compare(program.replace(from, to))).toHaveProperty('error');
    });
    it('preserves escaped intermediate values', () => {
        const actual = compare(program.replace('use bits', 'use bits\nuse io')
            .replace('return Score', 'Plain print\n  return Score'));
        // The final gather/reduction may fuse after Plain is stored; the
        // escaped XOR result must remain available for the print.
        expect(actual.kernels).toBe(1);
        expect(actual.compiled[0]).not.toContain('^');
        expect(actual.output).toEqual(['5 7 5 6 10 10']);
    });
    it('refreshes source arrays, selectors and lookup table on repeated calls', () => {
        const actual = compare(program.replace('use bits', 'use bits\nuse io') + ` print
Key 0 = 3
Weights 5 = 99
Cipher Weights Key Slots score print
Slots = (1 till 7) mod 3
Cipher Weights Key Slots score print`);
        expect(actual.kernels).toBe(3);
        expect(actual.output).toHaveLength(3);
    });
    it('rechecks a replaced builtin after a successful call', () => {
        function execute(tensorFusion: boolean) {
            const runtime = new Interpreter(undefined, { tensorFusion });
            try {
                const first = runtime.execute(program);
                runtime.execute('fun A replacement B\n  return A + B\nend');
                runtime.variables.set('bxor', runtime.variables.get('replacement')!);
                const second = runtime.execute('Cipher Weights Key Slots score');
                return [first, second];
            } finally { runtime.dispose(); }
        }
        expect(execute(true)).toEqual(execute(false));
    });
});


it('fuses each iteration of a local search loop', () => {
    const source = program.replace('  KeyStream = Key Slots', '  Score = 0\n  for Iter in 0 till 3\n  KeyStream = Key Slots')
        .replace('  return Score', '  end\n  return Score');
    expect(compare(source)).toMatchObject({ value: '43', kernels: 3 });
});

it('preserves missing cells through bitwise lookup fallback', () => {
    function execute(tensorFusion: boolean) {
        const runtime = new Interpreter(undefined, { tensorFusion });
        try {
            runtime.execute(program);
            runtime.variables.set('Cipher', createArraySnapshot([4n, MISSING, 6n, 7n, 8n, 9n]));
            return formatValue(runtime.execute('Cipher Weights Key Slots score')!);
        } catch (error) { return String(error); }
        finally { runtime.dispose(); }
    }
    expect(execute(true)).toEqual(execute(false));
});

it('does not invoke unproved sequence readers while binding a kernel', () => {
    function execute(tensorFusion: boolean) {
        const reads: string[] = [];
        const readsAtCompilation: string[][] = [];
        let kernels = 0;
        const runtime = new Interpreter(undefined, { tensorFusion, onTensorKernelExecuted: () => kernels++,
            onTensorKernelCompiled: () => readsAtCompilation.push([...reads]) });
        try {
            runtime.execute(program.replace('\nCipher Weights Key Slots score', '')
                .replace('fun Cipher Weights Key Slots score', "fun Cipher Weights Key Slots' score")
                .replace('KeyStream =', "KeyStream' =").replace('Plain =', "Plain' =").replace('Score =', "Score' ="));
            kernels = 0;
            readsAtCompilation.length = 0;
            const slots: RankSequence = { kind: 'sequence', plan: {
                name: 'host range', size: { kind: 'exact', value: 6n },
                *iterate() { for (let i = 0n; i < 6n; i++) { reads.push(`iterate:${i}`); yield i % 3n; } },
                at(i) { reads.push(`at:${i}`); return i % 3n; },
            } };
            runtime.variables.set('Slots', slots);
            return { value: runtime.execute('Cipher Weights Key Slots score'), reads, kernels, readsAtCompilation };
        } finally { runtime.dispose(); }
    }
    const reference = execute(false), actual = execute(true);
    expect(reference.reads).toEqual(Array.from({ length: 6 }, (_, i) => `iterate:${i}`));
    // The ordinary selector path finishes reading the opaque sequence before
    // a native kernel may reduce the resulting selection of stored Weights.
    expect(actual).toEqual({ ...reference, kernels: 1, readsAtCompilation: [reference.reads] });
});

it.each([
    { marker: "'", value: '0', kernels: 0 },
    { marker: '', value: '3', kernels: 0 },
])('preserves zip or broadcast for binding marker "$marker"', ({ marker, value, kernels }) => {
    const source = `use sequences
fun A${marker} score B${marker}
  Values${marker} = A + B
  return Values sum
end
A${marker} = 0 till 1
B${marker} = 0 till 3
A score B`;
    expect(compare(source)).toMatchObject({ value, kernels });
});

it.each(['at', 'iterate'] as const)('revalidates a modified modular sequence %s hook', hook => {
    function execute(tensorFusion: boolean) {
        let reads = 0, kernels = 0;
        const readsAtCompilation: number[] = [];
        const runtime = new Interpreter(undefined, { tensorFusion, onTensorKernelExecuted: () => kernels++,
            onTensorKernelCompiled: () => readsAtCompilation.push(reads) });
        try {
            runtime.execute(program.replace('\nCipher Weights Key Slots score', '')
                .replace('fun Cipher Weights Key Slots score', "fun Cipher Weights Key Slots' score")
                .replace('KeyStream =', "KeyStream' =").replace('Plain =', "Plain' =").replace('Score =', "Score' =")
                .replace('Slots =', "Slots' ="));
            kernels = 0;
            readsAtCompilation.length = 0;
            const slots = demandValue(runtime.variables.get('Slots')!) as RankSequence;
            runtime.variables.set('Slots', slots);
            if (hook === 'at') {
                const original = slots.plan.at!;
                slots.plan.at = function(index) { reads++; return original.call(this, index); };
            } else {
                const original = slots.plan.iterate;
                slots.plan.iterate = function* () { reads++; yield* original.call(this); };
            }
            return { value: runtime.execute('Cipher Weights Key Slots score'), reads, kernels, readsAtCompilation };
        } finally { runtime.dispose(); }
    }
    const reference = execute(false);
    expect(reference.reads).toBe(hook === 'at' ? 0 : 1);
    expect(execute(true)).toEqual({ ...reference, kernels: 1, readsAtCompilation: [reference.reads] });
});


it('keeps gather bindings local when the compilation callback reenters', () => {
    const runtime = new Interpreter();
    try {
        runtime.execute(program);
        const statement = parse('fun Cipher Weights Key Slots score\n return (Weights (Cipher bxor (Key Slots))) sum\nend').statements[0];
        if (!isFunctionStatement(statement)) throw Error('expected function');
        const outer = new Map(['Cipher', 'Weights', 'Key', 'Slots'].map(name => [name, runtime.variables.get(name)!]));
        let values = outer, entered = false;
        let nested: RankValue | undefined;
        const kernel = compileTensorKernel(statement.statements[0], {
            lookup: name => values.get(name), builtin: () => true,
            compiled() {
                if (entered) return;
                entered = true;
                values = new Map([
                    ['Cipher', createArraySnapshot([2n])], ['Weights', createArraySnapshot([0n, 11n, 22n, 33n])],
                    ['Key', createArraySnapshot([1n])], ['Slots', createArraySnapshot([0n])],
                ]);
                try { nested = kernel!.run(); } finally { values = outer; }
            },
        })!;
        expect(kernel.run()).toBe(43n);
        expect(nested).toBe(33n);
        expect(kernel.run()).toBe(43n);
    } finally { runtime.dispose(); }
});

it.each([
    ['array shape 2 3\n  4 5 6\n  7 8 9\nend', '(0 till 3) mod 3', '43'],
    ['array shape 2 3\n  4 5 6\n  7 8 9\nend', 'array 0', '39'],
    ['array shape 2 0 fill 0', '0 till 0', '0'],
])('broadcasts a gathered vector over a matrix (%s)', (cipher, slots, expected) => {
    const source = `use sequences
use bits
fun Cipher Key Slots score
  return (Cipher bxor (Key Slots)) sum
end
Cipher = ${cipher}
Key = array 1 2 3
Slots = ${slots}
Cipher Key Slots score`;
    expect(compare(source)).toMatchObject({ value: expected, kernels: 1 });
});
