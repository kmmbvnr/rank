import { ownedArray } from '../src/array-storage.js';
import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { clonePreviewValue } from '../src/preview-values.js';
import { argumentRankSignature, argumentSignature } from '../src/return-contract.js';

describe('argument signature memo', () => {
    it('invalidates signatures after a host replaces all cells with another homogeneous type', () => {
        const value = ownedArray([1n, 2n]);
        const first = argumentSignature([value]);
        value.items.splice(0, 2, 1.0, 2.0);
        expect(argumentSignature([value])).not.toBe(first);
    });

    it('does not mix up different scalars, arrays and argument counts', () => {
        const runtime = new Interpreter();
        runtime.execute('A = array 1 2 3\nB = array 1.5 2.5');
        const a = runtime.variables.get('A')!, b = runtime.variables.get('B')!;
        const keys = [[1n], [1.5], [a], [b], [a, b], [b, a], [1n, a], ['x']].map(args => argumentSignature(args));
        expect(new Set(keys).size).toBe(keys.length);
        expect(argumentSignature([a])).toBe(keys[2]);
    });

    it('specializes separately for integer and real arrays', () => {
        const runtime = new Interpreter();
        runtime.execute('fun double Row\n  return Row * 2\nend\nA = array 1 2 3\nB = array 1.0 2.0 3.0');
        expect(formatValue(runtime.execute('A double')!)).toBe('2 4 6');
        expect(formatValue(runtime.execute('B double')!)).toBe('2 4 6');
    });
});

for (const compiled of [true, false]) describe(`semantic array specialization (compiled ${compiled})`, () => {
    const runtime = () => new Interpreter(() => {}, { scalarCompilation: compiled,
        integerLoopCompilation: compiled, tensorFusion: compiled, functionBodyCompilation: compiled,
        scalarFunctionCompilation: compiled, scalarEntryCompilation: compiled });

    it('keeps the same signature across arithmetic, calls and materialization', () => {
        const interpreter = runtime();
        interpreter.execute('use sequences\nfun twice Values\n return Values * 2\nend\nSource = array 1 2\nLazy = Source * 2');
        const source = interpreter.variables.get('Source')!;
        const lazy = interpreter.variables.get('Lazy')!;
        const key = argumentSignature([source]);
        expect(argumentSignature([lazy])).toBe(key);
        interpreter.execute('A = Lazy twice\nMaterial = Lazy copy\nB = Material twice');
        for (const name of ['Lazy', 'Material', 'A', 'B']) {
            expect(argumentSignature([interpreter.variables.get(name)!])).toBe(key);
        }
        expect(formatValue(interpreter.variables.get('A')!)).toBe('4 8');
        expect(formatValue(interpreter.variables.get('B')!)).toBe('4 8');
        expect(argumentSignature([lazy])).toBe(key);
    });

    it('does not let copying an input evade its function return contract', () => {
        const interpreter = runtime();
        interpreter.execute('use sequences\nState = false\nfun result Values\n if State\n return true\n end\n return 1\nend\nSource = array 1 2\nLazy = Source * 2\nLazy result\nState = true\nMaterial = Lazy copy');
        expect(() => interpreter.execute('Material result')).toThrow(/returns integer and cannot return boolean/);
    });
});

it.each([3, 1024, 8192])('does not read lazy argument cells to call twice (size %i)', size => {
    const runtime = new Interpreter();
    let reads = 0;
    const source = { kind: 'array' as const, shape: [size], items: [], itemAt: (index: number) => {
        reads++;
        if (index === 1) throw new Error('unread cell');
        return 2n;
    } };
    runtime.variables.set('Source', source);
    runtime.execute('fun twice Values\n return Values * 2\nend\nResult = Source twice');
    expect(reads).toBe(0);
    expect(formatValue(runtime.execute('Result 0')!)).toBe('4');
    expect(reads).toBe(1);
    expect(() => runtime.execute('Result 1')).toThrow('unread cell');
});

it('keeps known element types through slices, transpose and reshape', () => {
    const runtime = new Interpreter();
    runtime.execute('use sequences\nSource = array shape 2 2 fill 1\nLazy = Source * 2\nRow = Lazy 0\nSlice = Lazy # #\nTransposed = Lazy transpose\nReshaped = Lazy reshape 2 2');
    const matrix = argumentSignature([runtime.variables.get('Source')!]);
    for (const name of ['Lazy', 'Slice', 'Transposed', 'Reshaped']) {
        expect(argumentSignature([runtime.variables.get(name)!])).toBe(matrix);
    }
    expect(argumentSignature([runtime.variables.get('Row')!])).toBe(argumentSignature([ownedArray([1n])]));
});

it('keeps genuinely unresolved lazy types unresolved after reading and copying', () => {
    const runtime = new Interpreter();
    let reads = 0;
    runtime.variables.set('Source', { kind: 'array', shape: [2], items: [], itemAt: index => {
        reads++;
        return BigInt(index);
    } });
    runtime.execute('use sequences\nLazy = Source * 2');
    const lazy = runtime.variables.get('Lazy')!;
    const key = argumentSignature([lazy]);
    expect(reads).toBe(0);
    runtime.execute('Material = Lazy copy');
    expect(reads).toBe(2);
    expect(argumentSignature([lazy])).toBe(key);
    expect(argumentSignature([runtime.variables.get('Material')!])).toBe(key);
    expect(key).not.toBe(argumentSignature([ownedArray([0n, 2n])]));
});

it('propagates types into tuple positions without reading lazy cells', () => {
    const runtime = new Interpreter();
    runtime.execute('use sequences\nSource = array 1 2\nLazy = Source * 2\nT = tuple Lazy "x"\nMaterial = Lazy copy\nU = tuple Material "y"');
    expect(argumentSignature([runtime.variables.get('T')!])).toBe(argumentSignature([runtime.variables.get('U')!]));
});

it('does not use host cell getters to select a specialization', () => {
    let reads = 0;
    const cells = [1n];
    Object.defineProperty(cells, 0, { get() { reads++; return 1n; } });
    const value = { kind: 'array' as const, shape: [1], items: cells };
    const key = argumentSignature([value]);
    expect(argumentSignature([value])).toBe(key);
    expect(reads).toBe(0);
});

it.each([false, true])('keeps integer and real lazy arguments distinct in either call order (real first %s)', realFirst => {
    const runtime = new Interpreter();
    runtime.execute('fun twice Values\n return Values * 2\nend\nIntegers = (array 1 2) * 2\nReals = (array 1.0 2.0) * 2');
    const integerKey = argumentSignature([runtime.variables.get('Integers')!]);
    const realKey = argumentSignature([runtime.variables.get('Reals')!]);
    expect(integerKey).not.toBe(realKey);
    for (const name of realFirst ? ['Reals', 'Integers'] : ['Integers', 'Reals']) {
        runtime.execute(`Result${name} = ${name} twice`);
        expect(argumentSignature([runtime.variables.get(`Result${name}`)!])).toBe(name === 'Reals' ? realKey : integerKey);
    }
});

it('keeps nested array signatures structural without forcing lazy child cells', () => {
    const runtime = new Interpreter();
    runtime.execute('Source = array 1 2\nLazy = Source * 2\nA = array Source\nB = array Lazy');
    expect(argumentSignature([runtime.variables.get('A')!])).toBe(argumentSignature([runtime.variables.get('B')!]));
});


it('preserves unresolved specialization through preview copies', () => {
    const value = { kind: 'array' as const, shape: [1], items: [], itemAt: () => 1n };
    const key = argumentSignature([value]);
    expect(argumentSignature([clonePreviewValue(value)])).toBe(key);
});

it('retains top-level argument ranks for empty-frame return-shape inference', () => {
    const runtime = new Interpreter();
    runtime.execute('T = tuple 1 "x"\nR = record\n .x = 1\nend');
    for (const name of ['T', 'R']) {
        const signature = JSON.parse(argumentRankSignature([runtime.variables.get(name)!]));
        expect(signature[0][1]).toBe(0);
    }
});

it('keeps unresolved metadata through dense transpose and selection paths', () => {
    const runtime = new Interpreter();
    runtime.variables.set('Source', { kind: 'array', shape: [256, 256], items: [], itemAt: () => 1n });
    runtime.execute('use sequences\nMaterial = Source copy\nTransposed = Material transpose\nSlice = Material # #');
    const key = argumentSignature([runtime.variables.get('Source')!]);
    for (const name of ['Material', 'Transposed', 'Slice']) {
        expect(argumentSignature([runtime.variables.get(name)!])).toBe(key);
    }
});

it('keeps an established type through empty replacement without typing the shared empty source', () => {
    const runtime = new Interpreter();
    runtime.execute('A = array 1\nB = array 1.0\nEmpty = array shape 0 fill .NA');
    const integerKey = argumentSignature([runtime.variables.get('A')!]);
    const realKey = argumentSignature([runtime.variables.get('B')!]);
    const emptyKey = argumentSignature([runtime.variables.get('Empty')!]);
    runtime.execute('A = Empty\nB = Empty');
    expect(argumentSignature([runtime.variables.get('A')!])).toBe(integerKey);
    expect(argumentSignature([runtime.variables.get('B')!])).toBe(realKey);
    expect(argumentSignature([runtime.variables.get('Empty')!])).toBe(emptyKey);
});

it('keeps an established type through all-missing replacement', () => {
    const runtime = new Interpreter();
    runtime.execute('A = array 1\nB = array 1.0\nMissing = array .NA .NA');
    const integerKey = argumentSignature([runtime.variables.get('A')!]);
    const realKey = argumentSignature([runtime.variables.get('B')!]);
    runtime.execute('A = Missing\nB = Missing');
    expect(argumentSignature([runtime.variables.get('A')!])).toBe(integerKey);
    expect(argumentSignature([runtime.variables.get('B')!])).toBe(realKey);
});
