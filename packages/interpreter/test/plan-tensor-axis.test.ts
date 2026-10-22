import { describe, expect, it } from 'vitest';
import { Interpreter, isNativeFunction, isRankArray } from '../src/index.js';
import { ownedArray } from '../src/array-storage.js';

describe.each([false, true])('tensor axis plan demand (compilation=%s)', compilation => {
    function runtime() {
        let entries = 0;
        const sources: string[] = [];
        const host = new Interpreter(() => {}, { compilation,
            onTensorKernelExecuted: () => entries++, onTensorKernelCompiled: source => sources.push(source) });
        const demand = () => {
            const value = host.execute('Saved = Result')!;
            return isRankArray(value) ? value.items : value;
        };
        return { host, demand, sources, entries: () => entries };
    }

    it('reduces a broadcast histogram without collecting its comparison cells', () => {
        const { host, demand, entries, sources } = runtime();
        try {
            host.execute(`use sequences
V = array 0 1 2 3 4 5 6
Tot = array 1 2 3 4
Hit' = Tot equal (V reshape 7 1)
Result' = Hit count axis 1`);
            expect(entries()).toBe(0);
            expect(demand()).toEqual([0n, 1n, 1n, 1n, 1n, 0n, 0n]);
            expect(demand()).toEqual([0n, 1n, 1n, 1n, 1n, 0n, 0n]);
            expect(entries()).toBe(compilation ? 14 : 0);
            expect(sources).toHaveLength(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it.each([
        ['sum', '', [9n, 21n]], ['mean', '', [3, 7]],
        ['min', '', [1n, 5n]], ['max', '', [5n, 9n]],
        ['count', 'greater 4', [1n, 3n]], ['any', 'greater 4', [true, true]],
        ['all', 'greater 4', [false, true]],
    ] as const)('shares the %s terminal with whole-array reductions', (operation, suffix, expected) => {
        const { host, demand, entries } = runtime();
        host.variables.set('Input', ownedArray([0n, 1n, 2n, 2n, 3n, 4n], [2, 3]));
        try {
            host.execute(`use sequences\nuse stats\nMapped' = (Input * 2 + 1) ${suffix}\nResult' = Mapped ${operation} axis 1`);
            expect(demand()).toEqual(expected);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });

    it.each(['2 0', '0 2'])('keeps source axis order for noncontiguous axes %s', axes => {
        const { host, demand, entries } = runtime();
        host.variables.set('Input', ownedArray(Array.from({ length: 24 }, (_, i) => BigInt(i)), [2, 3, 4]));
        try {
            host.execute(`use sequences\nMapped' = Input + 1\nResult' = Mapped sum axis ${axes}`);
            expect(demand()).toEqual([68n, 100n, 132n]);
            expect(entries()).toBe(compilation ? 3 : 0);
        } finally { host.dispose(); }
    });

    it.each([['any', 'greater 0.0', [true, true]], ['all', 'less 0.0', [false, false]]] as const)(
        '%s skips failing later cells in each row and checks visited cells', (operation, comparison, expected) => {
            const { host, demand, entries } = runtime();
            host.variables.set('Input', ownedArray([2n, 0n, 4n, 0n], [2, 2]));
            try {
                host.execute(`use sequences\nMask' = (12 / Input) ${comparison}\nResult' = Mask ${operation} axis 1`);
                expect(demand()).toEqual(expected);
                expect(entries()).toBe(compilation ? 2 : 0);
                // The first column succeeds; the second visits division by zero.
                host.execute(`Columns' = Mask ${operation} axis 0`);
                expect(() => host.execute('Saved = Columns')).toThrowError('division by zero');
                expect(() => host.execute('Saved = Columns')).toThrowError('division by zero');
            } finally { host.dispose(); }
        },
    );

    it('declines opaque readers without probing or retaining observations', () => {
        const { host, demand, entries } = runtime();
        const reads: number[] = [];
        host.variables.set('Input', { kind: 'array', shape: [2, 2], containsFiles: false,
            get items(): never { throw Error('must not collect host'); },
            itemAt(index) { reads.push(index); return BigInt(index + 1); },
        });
        try {
            host.execute("use sequences\nMapped' = Input + 1\nResult' = Mapped sum axis 0");
            expect(reads).toEqual([]);
            expect(demand()).toEqual([6n, 8n]);
            expect(demand()).toEqual([6n, 8n]);
            expect(reads).toEqual([0, 2, 1, 3, 0, 2, 1, 3]);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it.each(['any', 'all'])('%s short-circuits opaque cells in reference and compiled modes', operation => {
        const { host, demand, entries } = runtime();
        const reads: number[] = [];
        host.variables.set('Input', { kind: 'array', shape: [2, 2], containsFiles: false,
            get items(): never { throw Error('must not collect host'); },
            itemAt(index) { reads.push(index); if (index % 2) throw Error('late read'); return 1n; },
        });
        try {
            host.execute(`use sequences\nMask' = Input ${operation === 'any' ? 'greater' : 'less'} 0\nResult' = Mask ${operation} axis 1`);
            expect(demand()).toEqual([operation === 'any', operation === 'any']);
            expect(reads).toEqual([0, 2]);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('does not bypass a replaced standard implementation on a repeated demand', () => {
        const { host, demand, entries } = runtime();
        try {
            host.execute("use sequences\nInput = (array 1 2 3 4) reshape 2 2\nMapped' = Input + 1\nResult' = Mapped sum axis 1");
            expect(demand()).toEqual([5n, 9n]);
            const before = entries();
            const reducer = host.execute('sum')!;
            if (!isNativeFunction(reducer)) throw Error('expected reducer');
            let calls = 0;
            Object.defineProperty(reducer, 'call', { value: () => { calls++; return 77n; } });
            expect(demand()).toEqual([77n, 77n]);
            expect(calls).toBe(2);
            expect(entries()).toBe(before);
        } finally { host.dispose(); }
    });

    it.each([['sum', 0n], ['count', 0n], ['any', false], ['all', true]] as const)(
        'keeps empty %s cell identities and empty frames', (operation, identity) => {
            const { host, demand } = runtime();
            host.variables.set('Input', ownedArray([], [2, 0]));
            try {
                host.execute(`use sequences\nMapped' = Input ${operation === 'sum' ? '+ 1' : 'greater 0'}\nResult' = Mapped ${operation} axis 1`);
                expect(demand()).toEqual([identity, identity]);
                host.execute(`Empty = Mapped ${operation} axis 0`);
                const empty = host.variables.get('Empty')!;
                expect(isRankArray(empty) && empty.shape).toEqual([0]);
            } finally { host.dispose(); }
        },
    );

    it.each(['mean', 'min', 'max'])('retains empty %s errors on retry', operation => {
        const { host, demand } = runtime();
        host.variables.set('Input', ownedArray([], [2, 0]));
        try {
            host.execute(`use stats\nMapped' = Input + 1\nResult' = Mapped ${operation} axis 1`);
            expect(() => demand()).toThrowError(/requires at least one value/);
            expect(() => demand()).toThrowError(/requires at least one value/);
        } finally { host.dispose(); }
    });

    it('reduces all axes to a scalar and observes current storage on a new demand', () => {
        const { host, demand, entries } = runtime();
        const source = ownedArray([1n, 2n, 3n, 4n], [2, 2]);
        host.variables.set('Input', source);
        try {
            host.execute("use sequences\nMapped' = Input + 1\nResult' = Mapped sum axis 1 0");
            expect(demand()).toBe(14n);
            source.items[0] = 10n;
            expect(demand()).toBe(23n);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });

    it('rechecks the underlying reader after the compilation observer runs', () => {
        let compiled = false, entries = 0, reads = 0;
        const source = ownedArray([1n, 2n, 3n, 4n], [2, 2]);
        const replaceReader = () => Object.defineProperty(source, 'itemAt', {
            value: () => { reads++; return 7n; }, configurable: true,
        });
        const host = new Interpreter(() => {}, { compilation,
            onTensorKernelCompiled: () => { compiled = true; replaceReader(); },
            onTensorKernelExecuted: () => entries++ });
        host.variables.set('Input', source);
        try {
            host.execute("use sequences\nMapped' = Input + 1\nResult' = Mapped sum axis 1");
            if (!compilation) replaceReader();
            const value = host.execute('Saved = Result')!;
            expect(isRankArray(value) && value.items).toEqual([16n, 16n]);
            expect(compiled).toBe(compilation);
            expect(reads).toBe(4);
            expect(entries).toBe(0);
        } finally { host.dispose(); }
    });
});
