import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

const snapshots = [
    ['Limit = 6\nfun X below = X less Limit', '1 to 10 filter below', 'Limit = 3', '1 2 3 4 5'],
    ['Limit = 6\nfun X below = X less Limit\nfun X predicate = X below',
        '1 to 10 filter predicate', 'Limit = 3', '1 2 3 4 5'],
    ['Limit = 6\nfun X predicate\n fun Y below = Y less Limit\n return X below\nend',
        '1 to 10 filter predicate', 'Limit = 3', '1 2 3 4 5'],
    ['Offset = 10\nfun X shift_by = X + Offset', '(array 1 2 3) shift_by rank 0', 'Offset = 20', '11 12 13'],
    ['fun X double = X * 2\nstep = double\npipeline = step abs\nfun X triple = X * 3',
        '(1 to 3) pipeline rank 0', 'step = triple', '2 4 6'],
] as const;

describe.each([false, true])('plan callback dependencies (compilation=%s)', compilation => {
    it.each(snapshots)('captures callback data versions: %s', (setup, recipe, rebind, expected) => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute(`use sequences\nuse numbers\n${setup}\nPlan' = ${recipe}`);
            host.execute(rebind);
            expect(formatValue(host.execute('Plan')!)).toBe(expected);
            expect(formatValue(host.execute('Plan')!)).toBe(expected);
        } finally { host.dispose(); }
    });

    it('keeps captured names distinct from a shadowing parameter', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute([
                'Limit = 6', 'fun X below = X less Limit', 'fun Limit selected',
                ' fun X predicate = X below', " Plan' = 1 to 10 filter predicate",
                ' Limit = 2', ' return Plan', 'end', "Saved' = 3 selected", 'Limit = 8',
            ].join('\n'));
            expect(formatValue(host.execute('Saved')!)).toBe('1 2 3 4 5');
        } finally { host.dispose(); }
    });

    it('captures record and container data without an unsupported-snapshot restriction', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute([
                'use algo', 'Settings = record', ' .limit = 5', 'end',
                'Items = new set', 'Items add 1', 'Items add 3',
                'fun X accepted = (X less Settings .limit) and (X in Items)',
                "Plan' = 1 to 10 filter accepted", 'Items = new set',
                'Settings = record', ' .limit = 0', 'end',
            ].join('\n'));
            expect(formatValue(host.execute('Plan')!)).toBe('1 3');
            expect(formatValue(host.execute('Plan')!)).toBe('1 3');
        } finally { host.dispose(); }
    });

    it('captures imported callback dependencies in the defining module', () => {
        const host = new Interpreter(undefined, { compilation,
            loadModule: () => ({ id: 'callback.ra', source: 'Limit = 6\nfun X below = X less Limit' }),
        });
        try {
            host.execute('use "callback" as H\nH.run');
            host.execute("Plan' = 1 to 10 filter H.below");
            host.execute('H.Limit = 3');
            expect(formatValue(host.execute('Plan')!)).toBe('1 2 3 4 5');
            expect(formatValue(host.execute('Plan')!)).toBe('1 2 3 4 5');
        } finally { host.dispose(); }
    });
});
