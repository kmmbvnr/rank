import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { tuple, type RankArray } from '../src/value.js';

for (const compiled of [true, false]) describe(`tuples and homogeneous arrays (compiled ${compiled})`, () => {
    const runtime = () => new Interpreter(() => {}, { scalarCompilation: compiled, integerLoopCompilation: compiled,
        tensorCellCompilation: compiled });
    it('unpacks fixed positions across repeated calls', () => {
        const r = runtime();
        r.execute('fun items Flag\n if Flag\n return tuple 1 "yes"\n end\n return tuple 2 "no"\nend\nunpack X Y = true items\nunpack X Y = false items');
        expect(r.execute('X')).toBe(2n);
        expect(r.execute('Y')).toBe('no');
    });
    it.each([['tuple 1 "yes"', 'tuple 2 3'], ['tuple 1 "yes"', 'tuple 2'],
        ['tuple (array 1) "x"', 'tuple (array "bad") "y"']])('checks every result position in either call order', (a, b) => {
        for (const flag of ['true', 'false']) {
            const r = runtime();
            r.execute(`fun items Flag\n if Flag\n return ${a}\n end\n return ${b}\nend\n${flag} items`);
            expect(() => r.execute(`${flag === 'true' ? 'false' : 'true'} items`)).toThrow(/cannot receive/);
        }
    });
    it('keeps tuple bindings fixed and allows nested array lengths to change', () => {
        const r = runtime();
        r.execute('T = tuple (array 1) "x"\nT = tuple (array 2 3) "y"');
        expect(formatValue(r.execute('T 0')!)).toBe('2 3');
        expect(() => r.execute('T = tuple (array 1) 2')).toThrow(/cannot receive/);
        expect(() => r.execute('T 0 = array 2')).toThrow();
    });
    it('has structural equality, length and distinct type', () => {
        const r = runtime();
        expect(r.execute('(tuple 1 "x") equal (tuple 1 "x")')).toBe(true);
        expect(r.execute('(tuple 1 "x") len')).toBe(2n);
        expect(formatValue(r.execute('(tuple 1 "x") type')!)).toBe('.tuple');
        expect(r.execute('(tuple) len')).toBe(0n);
    });
    it('does not eagerly inspect arrays inside a tuple', () => {
        const r = runtime();
        let reads = 0;
        const values: RankArray = { kind: 'array', shape: [2], items: [], itemAt: index => { reads++; return BigInt(index); } };
        r.variables.set('Input', tuple([values, 'label']));
        r.execute('T = Input');
        expect(reads).toBe(0);
        expect(r.execute('T 0 1')).toBe(1n);
        expect(reads).toBe(1);
    });
    it('preserves arrays by value and records by reference inside tuples', () => {
        const r = runtime();
        r.execute('A = array 1 2\nR = record\n .x = 1\nend\nT = tuple A R\nA 0 = 9\nR .x = 2');
        expect(r.execute('T 0 0')).toBe(1n);
        expect(r.execute('T 1 .x')).toBe(2n);
    });
    it.each(['array 1 "x"', 'array 1 2.0', 'array (array 1) (array "x")',
        'array (tuple 1 "x") (tuple 2 3)'])('rejects heterogeneous %s', source => {
        expect(() => runtime().execute(source)).toThrow(/one element type|cannot receive/);
    });
    it('allows missing and integer infinity sentinels', () => {
        expect(formatValue(runtime().execute('use numbers\nA = array infinity .NA\nA 0 = 1\nA 1 = infinity\nA')!)).toBe('1 infinity');
    });
});


describe('tuple boundaries', () => {
    it.each(['[1,"x"]', '[[1],["x"]]', '[1,2.0]'])('decodes mixed JSON %s as a tuple', text => {
        const runtime = new Interpreter();
        expect(runtime.execute(`use json\n${JSON.stringify(text)} json`)).toMatchObject({ kind: 'tuple' });
    });
    it('keeps homogeneous JSON and captures as arrays', () => {
        const runtime = new Interpreter();
        expect(runtime.execute('use json\n"[1,2]" json')).toMatchObject({ kind: 'array' });
        expect(runtime.execute('use text\n"1 2" "/integer /integer" parse')).toMatchObject({ kind: 'array' });
        expect(runtime.execute('"1 x" "/integer /word" parse')).toMatchObject({ kind: 'tuple' });
    });
    it('keeps one type per named matrix column across writes', () => {
        const r = new Interpreter();
        r.execute('use json\nuse tables\nRows = "[{\\"id\\":1,\\"name\\":\\"a\\"},{\\"id\\":2,\\"name\\":\\"b\\"}]" json table\nM = Rows (array .id .name)\nM 0 0 = 3\nM 1 1 = "c"');
        expect(r.execute('M 0 0')).toBe(3n);
        expect(r.execute('M 0')).toMatchObject({ kind: 'tuple', items: [3n, 'a'] });
        expect(r.execute('M 0 #')).toMatchObject({ kind: 'tuple', items: [3n, 'a'] });
        r.execute('use sequences\nC = (M (array 0 1)) copy');
        expect(r.execute('C 1 1')).toBe('c');
        expect(r.execute('M 1 1')).toBe('c');
        expect(() => r.execute('M 0 0 = "bad"')).toThrow(/cannot receive/);
    });
    it('rejects mixed cells in a table column', () => {
        const r = new Interpreter();
        r.execute('use json\nuse tables\nRows = "[{\\"x\\":1},{\\"x\\":\\"bad\\"}]" json');
        expect(() => r.execute('Rows table')).toThrow(/cannot receive/);
        expect(() => formatValue(r.execute('Rows .x')!)).toThrow(/one element type/);
    });
});
