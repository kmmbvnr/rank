import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function failure(run: () => unknown): RankError {
    try { run(); } catch (error) {
        expect(error).toBeInstanceOf(RankError);
        return error as RankError;
    }
    throw new Error('Expected a protected write to fail');
}

describe.each([false, true])('plan binding locations (compilation=%s)', compilation => {
    it('reports the plan origin and keeps the static error at the write', () => {
        const host = new Interpreter(undefined, { compilation, sourceId: 'script.ra' });
        try {
            const error = failure(() => host.execute([
                'use sequences', 'W = (1 to 5 array) * 2', 'if true',
                "  Pw' = W scan +", 'end', 'W 0 = 7',
            ].join('\n')));
            expect(error.message).toBe('W is read-only because plan Pw reads it; copy it before mutation.'
                + ' Plan bound at script.ra:4:3.');
            expect(error.location).toMatchObject({ sourceId: 'script.ra', line: 6, column: 1 });
            expect(error.format()).toContain('at script.ra:6:1');
            expect(host.variables.has('W')).toBe(false);
        } finally { host.dispose(); }
    });

    it('retains the origin after full consumption and source rebinding in later cells', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute("use sequences\nW = (1 to 5 array) * 2\nPw' = W scan +");
            expect(formatValue(host.execute('Pw array')!)).toBe('2 6 12 20 30');
            host.execute('W = array 8 9');
            const error = failure(() => host.execute('W 0 = 7'));
            expect(error.message).toContain('Plan bound at <input>:3:1.');
            expect(error.location).toMatchObject({ line: 1, sourceLine: 'W 0 = 7' });
        } finally { host.dispose(); }
    });

    it('identifies the module plan when a second run fails', () => {
        const host = new Interpreter(undefined, { compilation, sourceId: 'test.ra', loadModule: () => ({
            id: 'fixture.ra', source: [
                'use sequences', 'W = (1 to 5 array) * 2', 'W 0 = 7', "Pw' = W scan +", 'Pw array',
            ].join('\n'),
        }) });
        try {
            host.execute('use "fixture" as F\nF.run');
            const error = failure(() => host.execute('F.run'));
            expect(error.message).toContain('Plan bound at fixture.ra:4:1.');
            expect(error.location).toMatchObject({ sourceId: 'fixture.ra', line: 3, sourceLine: 'W 0 = 7' });
        } finally { host.dispose(); }
    });

    it('uses the importing plan origin for protection of a qualified source', () => {
        const host = new Interpreter(undefined, { compilation, sourceId: 'parent.ra', loadModule: () => ({
            id: 'data.ra', source: 'A = array 1 2',
        }) });
        try {
            host.execute('use "data" as H\nH.run\nPlan\' = H.A * 2');
            const error = failure(() => host.execute('H.A 0 = 9'));
            expect(error.message).toContain('Plan bound at parent.ra:3:1.');
            expect(error.location).toMatchObject({ sourceId: 'parent.ra', line: 1 });
        } finally { host.dispose(); }
    });

    it('retains the origin for writes through shared container aliases', () => {
        const host = new Interpreter(undefined, { compilation, sourceId: 'aliases.ra' });
        try {
            host.execute("use algo\nA = new queue\nAlias = A\nPlan' = A len");
            const error = failure(() => host.execute('Alias push 9'));
            expect(error.message).toContain('A is read-only because plan Plan reads it');
            expect(error.message).toContain('Plan bound at aliases.ra:4:1.');
            expect(error.location).toMatchObject({ line: 1, sourceLine: 'Alias push 9' });
        } finally { host.dispose(); }
    });

    it('keeps the first protecting plan origin when another plan captures the name', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute("A = array 1 2\nFirst' = A * 2");
            host.execute("Second' = A + 1");
            const error = failure(() => host.execute('A 0 = 9'));
            expect(error.message).toContain('plan First reads it');
            expect(error.message).toContain('Plan bound at <input>:2:1.');
        } finally { host.dispose(); }
    });

    it('leaves deferred parameter diagnostics unchanged', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            const error = failure(() => host.execute("fun X' change\n X 0 = 9\n return X\nend"));
            expect(error.message).toBe('X is a deferred parameter and is read-only; bind a computed local value before mutation.');
        } finally { host.dispose(); }
    });
});
