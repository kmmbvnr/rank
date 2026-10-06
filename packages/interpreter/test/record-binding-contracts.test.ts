import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { LocalFrame } from '../src/frame.js';
import { MISSING, type RankRecord, type RankArray } from '../src/value.js';

const record = (fields: string) => `record\n ${fields}\nend`;
for (const compiled of [true, false]) describe(`record binding contracts (compiled ${compiled})`, () => {
    const runtime = () => new Interpreter(() => {}, { integerLoopCompilation: compiled, scalarCompilation: compiled,
        tensorCellCompilation: compiled });
    it.each(['.name = "Ada"', '.x = "bad"', '.x = array 1', '.x = 1\n .y = 2'])
    ('rejects a replacement with %s atomically', fields => {
        const r = runtime();
        r.execute(`R = ${record('.x = 1')}\nAlias = R`);
        const old = r.variables.get('R');
        expect(() => r.execute(`R = ${record(fields)}`)).toThrow(/R.*cannot receive/);
        expect(r.variables.get('R')).toBe(old);
        expect(r.variables.get('Alias')).toBe(old);
    });
    it('allows new values, field order and array lengths, preserving identity', () => {
        const r = runtime();
        r.execute(`R = ${record('.count = 1\n .items = array 1 2')}\nAlias = R`);
        r.execute(`Next = ${record('.items = array 3 4 5\n .count = 2')}\nR = Next`);
        expect(r.variables.get('R')).toBe(r.variables.get('Next'));
        expect(r.variables.get('R')).not.toBe(r.variables.get('Alias'));
        expect(formatValue(r.execute('R .items')!)).toBe('3 4 5');
        expect(r.execute('Alias .count')).toBe(1n);
    });
    it.each(['array shape 1 1 1 fill 0', 'array "bad"', 'array (array "bad")'])
    ('checks recursive field ranks and cells: %s', replacement => {
        const r = runtime();
        r.execute(`R = ${record('.child = ' + record('.items = array (array 1)'))}`);
        expect(() => r.execute(`R = ${record('.child = ' + record('.items = ' + replacement))}`))
            .toThrow(/cannot receive/);
    });
    it('keeps contracts through missing and empty replacements', () => {
        const r = runtime();
        r.execute(`R = .NA\nR = ${record('.items = array 1')}\nR = .NA`);
        r.execute(`R = ${record('.items = array shape 0 fill .NA')}\nAlias = R`);
        expect(() => r.execute('Alias .items = array "bad"')).toThrow(/integer.*text/);
        expect(() => r.execute(`R = ${record('.items = array "bad"')}`)).toThrow(/integer.*text/);
    });
    it('observes settlement through an alias before rebinding', () => {
        const r = runtime();
        r.execute(`R = ${record('.items = array shape 0 fill .NA')}\nAlias = R\nAlias .items = array 1`);
        expect(() => r.execute(`R = ${record('.items = array "bad"')}`)).toThrow(/integer.*text/);
    });
    it('does not settle an empty field when another field rejects the replacement', () => {
        const r = runtime();
        r.execute(`R = ${record('.items = array shape 0 fill .NA\n .tag = 1')}`);
        expect(() => r.execute(`R = ${record('.items = array 1\n .tag = "bad"')}`)).toThrow(/cannot receive/);
        r.execute(`R = ${record('.items = array "ok"\n .tag = 2')}`);
        expect(r.execute('R .tag')).toBe(2n);
    });
    it('checks parameters, local slots and captured rebindings', () => {
        const r = runtime();
        r.execute(`fun change R\n R = ${record('.y = 2')}\nend\nR = ${record('.x = 1')}`);
        expect(() => r.execute('R change')).toThrow(/cannot receive/);
        expect(() => r.execute(`fun outer\n R = ${record('.x = 1')}\n fun change_local\n R = ${record('.y = 2')}\n end\n change_local\nend\nouter`)).toThrow(/cannot receive/);
    });
    it('allows stateful closures and fresh schemas on separate invocations', () => {
        const r = runtime();
        r.execute(`fun identity R\n R = R\n return R\nend\nA = ${record('.x = 1')}\nB = ${record('.y = 2')}\nC = A identity\nD = B identity`);
        expect(r.execute('D .y')).toBe(2n);
        expect(r.execute(`fun outer\n R = ${record('.x = 1')}\n fun increment\n R = ${record('.x = R .x + 1')}\n return R .x\n end\n increment\n increment\n return R .x\nend\nouter`)).toBe(3n);
    });
});

it('copies frame contracts and clears them at the end of the binding lifetime', () => {
    const r = new Interpreter();
    const a = r.execute(record('.x = 1'))!;
    const b = r.execute(record('.y = 1'))!;
    const frame = new LocalFrame(undefined);
    frame.define('R', a, new Set(['record']));
    frame.set('R', MISSING);
    const fork = new LocalFrame(undefined);
    fork.adoptContracts(frame);
    expect(() => fork.set('R', b)).toThrow(/cannot receive/);
    frame.unset('R');
    frame.define('R', b, new Set(['record']));
    expect(frame.reset()).toBe(true);
    frame.define('R', a, new Set(['record']));
});

it('isolates refinements in a preview, including a temporarily missing binding', () => {
    const r = new Interpreter();
    r.execute(`R = ${record('.items = array shape 0 fill .NA')}`);
    const preview = r.forkForPreview();
    preview.execute('R .items = array 1');
    expect(() => preview.execute(`R = ${record('.items = array "bad"')}`)).toThrow(/integer.*text/);
    r.execute(`R = ${record('.items = array "ok"')}`);
    r.execute('R = .NA');
    const missingPreview = r.forkForPreview();
    expect(() => missingPreview.execute(`R = ${record('.items = array 1')}`)).toThrow(/text.*integer/);
});

it('reuses an established schema without rereading record-array cells', () => {
    const r = new Interpreter();
    const value = r.execute(record('.nodes = array (' + record('.x = 1') + ')')) as RankRecord;
    const nodes = value.entries.get('nodes') as RankArray;
    let reads = 0;
    const read = nodes.itemAt;
    value.entries.set('nodes', { ...nodes, itemAt: (index: number) => {
        reads++; return read ? read(index) : nodes.items[index];
    } });
    const frame = new LocalFrame(undefined);
    frame.define('R', value, new Set(['record']));
    frame.set('R', value);
    expect(reads).toBe(0);
});

it('observes a refinement made during native record inspection', () => {
    const r = new Interpreter();
    r.execute(`R = ${record('.items = array shape 0 fill .NA')}\nAlias = R`);
    const next: RankRecord = { kind: 'record', entries: new Map([['items', {
        kind: 'array', shape: [1], items: [], itemAt: () => {
            r.execute('Alias .items = array "settled"');
            return 1n;
        },
    } as RankArray]]), types: new Map([['items', 'array']]) };
    r.variables.set('Next', next);
    expect(() => r.execute('R = Next')).toThrow(/text.*integer/);
    expect(formatValue(r.execute('R .items')!)).toBe('settled');
});
