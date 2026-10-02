import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { run } from './support.js';
import { checkRecordField } from '../src/record-contract.js';
import type { RankArray, RankRecord } from '../src/value.js';

describe('fixed record field contracts', () => {
    it('preserves rank and cells through aliases and function calls', () => {
        for (const replacement of ['array shape 2 2 fill 0', 'array "bad"', 'array 1.0']) {
            const runtime = new Interpreter();
            runtime.execute('R = record\n .items = array 1 2\nend\nAlias = R');
            expect(() => runtime.execute(`fun change X\n X .items = ${replacement}\nend\nAlias change`)).toThrow(/record field .items/);
            expect(formatValue(runtime.execute('R .items')!)).toBe('1 2');
        }
    });

    it('allows different lengths on every axis', () => {
        expect(run('use sequences\nR = record\n .items = array shape 2 2 fill 0\nend\nR .items = array shape 3 1 fill 1\nR .items shape'))
            .toBe('3 1');
    });

    it('checks compound field writes', () => {
        expect(() => run('R = record\n .items = array 1 2\nend\nR .items /= 2'))
            .toThrow(/integer.*real/);
    });

    it('checks nested record names and field types', () => {
        for (const field of ['.name = 1', '.x = "bad"', '.x = array 1']) {
            expect(() => run(`R = record\n .point = record\n .x = 1\n end\nend\nR .point = record\n ${field}\nend`))
                .toThrow(/record field .point/);
        }
        expect(run('R = record\n .point = record\n .x = 1\n .y = 2\n end\nend\nR .point = record\n .y = 3\n .x = 4\nend\nR .point .x'))
            .toBe('4');
    });

    it('checks nested aliases and preserves refined empty-array contracts on replacement', () => {
        const runtime = new Interpreter();
        runtime.execute('R = record\n .point = record\n .items = array 1\n end\nend\nR .point = record\n .items = array shape 0 fill 0\nend\nAlias = R .point');
        expect(() => runtime.execute('Alias .items = array "bad"')).toThrow(/integer.*text/);
        expect(() => runtime.execute('R .point .items = array shape 1 1 fill 1')).toThrow(/rank 1.*rank 2/);
    });

    it('retains the contract in with copies, even if the current array is empty', () => {
        const runtime = new Interpreter();
        runtime.execute('R = record\n .items = array 1\n .n = 0\nend\nR .items = array shape 0 fill 0\nS = R with\n .n = 1\nend');
        expect(() => runtime.execute('S .items = array "bad"')).toThrow(/integer.*text/);
        expect(() => runtime.execute('S = R with\n .items = array shape 1 1 fill 0\nend')).toThrow(/rank 1.*rank 2/);
        expect(runtime.execute('R .n')).toBe(0n);
        expect(runtime.execute('S .n')).toBe(1n);
    });

    it('does not commit a partial nested contract after a rejected assignment', () => {
        const runtime = new Interpreter();
        runtime.execute('R = record\n .child = record\n .items = array shape 0 fill 0\n .tag = 1\n end\nend');
        expect(() => runtime.execute('R .child = record\n .items = array 1\n .tag = "bad"\nend')).toThrow(/integer.*text/);
        runtime.execute('R .child = record\n .items = array "ok"\n .tag = 2\nend');
        expect(runtime.execute('R .child .tag')).toBe(2n);
    });

    it('keeps field arrays isolated from ordinary array writes', () => {
        expect(run('R = record\n .items = array 1 2\nend\nA = R .items\nA 0 = 9\nR .items 0')).toBe('1');
    });

    it('rechecks a contract established through an alias during a lazy read', () => {
        const runtime = new Interpreter();
        const record = runtime.execute('R = record\n .items = array shape 0 fill 0\nend\nR') as RankRecord;
        const lazy: RankArray = { kind: 'array', shape: [1], items: [], itemAt: () => {
            runtime.execute('R .items = array "callback"');
            return 1n;
        } };
        expect(() => checkRecordField(record, 'items', lazy)).toThrow(/text.*integer/);
        expect(formatValue(runtime.execute('R .items')!)).toBe('callback');
    });

    it('enforces the contract on native graph records too', () => {
        expect(() => run('use graph\nG = new graph (1 to 3) .directed\nR = G topological\nR .order = array "bad"'))
            .toThrow(/integer.*text/);
    });
});

describe('structural record return contracts', () => {
    for (const field of ['.other = 1', '.value = "bad"', '.value = array 1']) {
        it(`rejects incompatible return ${field}`, () => {
            const runtime = new Interpreter();
            runtime.execute(`fun choose Flag\n if Flag\n return record\n .value = 1\n end\n end\n return record\n ${field}\n end\nend\ntrue choose`);
            expect(() => runtime.execute('false choose')).toThrowError(expect.objectContaining({ rankKind: 'ReturnTypeMismatch' }));
        });
    }

    it('checks nested ranks on recursive returns', () => {
        expect(() => run('fun build N\n if N equal 0\n return record\n .inner = record\n .data = array 1\n end\n end\n end\n Previous = (N - 1) build\n return record\n .inner = record\n .data = array shape 1 1 fill 1\n end\n end\nend\n1 build'))
            .toThrowError(expect.objectContaining({ rankKind: 'ReturnTypeMismatch' }));
    });

    it('specializes separately for structurally different record arguments', () => {
        const runtime = new Interpreter();
        runtime.execute('fun identity R\n return R\nend\nA = record\n .x = 1\nend\nB = record\n .name = "text"\nend\nC = A identity\nD = B identity');
        expect(runtime.execute('C .x')).toBe(1n);
        expect(runtime.execute('D .name')).toBe('text');
    });

    it('does not change a tuple field to an array to match another return', () => {
        const runtime = new Interpreter();
        runtime.execute('fun choose Flag\n if Flag\n return record\n .items = tuple 1 "text"\n end\n end\n return record\n .items = array 1\n end\nend\ntrue choose');
        expect(() => runtime.execute('false choose'))
            .toThrowError(expect.objectContaining({ rankKind: 'ReturnTypeMismatch' }));
    });
});
