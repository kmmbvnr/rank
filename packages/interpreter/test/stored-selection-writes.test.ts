import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, typeName, type RankArray, type RankRecord, type RankValue } from '../src/index.js';
import { ownedArray, ownedObject, readArrayItem } from '../src/array-storage.js';
import { completed } from '../src/execution.js';
import { FlatRecords } from '../src/flat.js';
import { type RankPlan } from '../src/plan.js';
import { sequence } from '../src/sequence.js';
import { parseCsvToArrow, type RankArrowTable } from '../src/arrow-table.js';

function plan(compute: () => RankValue): RankPlan {
    return { kind: 'plan', dependencies: new Map(), evaluate: () => completed(compute()) };
}
function record(value: RankValue): RankRecord {
    return { kind: 'record', entries: new Map([['value', value]]), types: new Map([['value', typeName(value)]]) };
}
function counted() {
    let reads = 0;
    return { reads: () => reads, value: sequence({ name: 'replacement values', size: { kind: 'exact', value: 2n },
        *iterate() { for (const value of [2n, 3n]) { reads++; yield value; } },
    }) };
}

describe.each([false, true])('stored selection writes (compilation=%s)', compilation => {
    function runtime() { return new Interpreter(undefined, { compilation }); }

    it.each(['=', '+='])('uses a finite sequence as the vector replacement for %s', operator => {
        const source = counted(), host = runtime();
        host.variables.set('Input', source.value);
        try {
            host.execute(`A = array 10 20\nA # ${operator} Input`);
            expect(formatValue(host.execute('A')!)).toBe(operator === '=' ? '2 3' : '12 23');
            expect(formatValue(host.execute('A')!)).toBe(operator === '=' ? '2 3' : '12 23');
            expect(source.reads()).toBe(2);
        } finally { host.dispose(); }
    });

    it.each(['0 =', '0 +=', '# =', '# +='])('demands a scalar plan once for A %s', write => {
        let calls = 0;
        const host = runtime();
        host.variables.set('Input', plan(() => { calls++; return 7n; }));
        try {
            host.execute(`A = array 10 20\nA ${write} Input`);
            const expected = write === '0 =' ? '7 20' : write === '0 +=' ? '17 20' : write === '# =' ? '7 7' : '17 27';
            expect(formatValue(host.execute('A')!)).toBe(expected);
            expect(calls).toBe(1);
        } finally { host.dispose(); }
    });

    it('completes a shared nested value once before broadcasting it to array cells', () => {
        let calls = 0;
        const input = record(plan(() => { calls++; return 7n; }));
        const host = runtime();
        host.variables.set('Input', input);
        host.variables.set('A', ownedArray([record(0n), record(0n)]));
        try {
            host.execute('A # = Input');
            const array = host.variables.get('A') as RankArray;
            const first = readArrayItem(array, 0) as RankRecord;
            expect(first.entries.get('value')).toBe(7n);
            expect(readArrayItem(array, 1)).toBe(first);
            expect(calls).toBe(1);
            expect(input.entries.get('value')).toHaveProperty('kind', 'plan');
        } finally { host.dispose(); }
    });

    it('validates replacement shape before demanding its cells', () => {
        let reads = 0;
        const host = runtime();
        host.variables.set('Input', { kind: 'array', shape: [3], items: [], itemAt: () => {
            reads++; throw new Error('must not read');
        } });
        try {
            host.execute('A = array 10 20');
            expect(() => host.execute('A # = Input')).toThrowError('assignment shape mismatch: 2 and 3');
            expect(reads).toBe(0);
            expect(formatValue(host.execute('A')!)).toBe('10 20');
        } finally { host.dispose(); }
    });

    it('does not publish an earlier cell when a later plan fails', () => {
        let calls = 0;
        const host = runtime();
        host.variables.set('Input', ownedArray([
            plan(() => { calls++; return 7n; }),
            plan(() => { calls++; throw new Error('replacement failed'); }),
        ]));
        try {
            host.execute('A = array 10 20\nBefore = A');
            expect(() => host.execute('A # = Input')).toThrowError('replacement failed');
            expect(formatValue(host.execute('A')!)).toBe('10 20');
            expect(formatValue(host.execute('Before')!)).toBe('10 20');
            expect(calls).toBe(2);
        } finally { host.dispose(); }
    });

    it.each(['objects', 'arrow'] as const)('completes finite column replacements in %s tables', kind => {
        const source = counted(), host = runtime();
        host.variables.set('Rows', kind === 'arrow' ? parseCsvToArrow('value\n10\n20\n')
            : ownedArray([ownedObject(new Map([['value', 10n]])), ownedObject(new Map([['value', 20n]]))]));
        host.variables.set('Input', source.value);
        try {
            host.execute('use tables\nRows .value += Input');
            expect(formatValue(host.execute('Rows .value')!)).toBe('12 23');
            expect(formatValue(host.execute('Rows .value')!)).toBe('12 23');
            expect(source.reads()).toBe(2);
        } finally { host.dispose(); }
    });

    it.each(['objects', 'arrow'] as const)('completes shared nested column values in %s tables', kind => {
        let calls = 0;
        const input = record(plan(() => { calls++; return 7n; })), host = runtime();
        host.variables.set('Rows', kind === 'arrow' ? parseCsvToArrow('value\n10\n20\n')
            : ownedArray([ownedObject(new Map([['value', 10n]])), ownedObject(new Map([['value', 20n]]))]));
        host.variables.set('Input', input);
        try {
            host.execute('use tables\nRows .nested = Input');
            const values = host.execute('Rows .nested') as RankArray;
            const first = readArrayItem(values, 0) as RankRecord;
            expect(first.entries.get('value')).toBe(7n);
            expect(readArrayItem(values, 1)).toBe(first);
            expect(calls).toBe(1);
            expect(input.entries.get('value')).toHaveProperty('kind', 'plan');
        } finally { host.dispose(); }
    });

    it.each(['objects', 'arrow'] as const)('keeps every %s table cell on completion failure', kind => {
        const host = runtime();
        const initial = kind === 'arrow' ? parseCsvToArrow('value\n10\n20\n')
            : ownedArray([ownedObject(new Map([['value', 10n]])), ownedObject(new Map([['value', 20n]]))]);
        host.variables.set('Rows', initial);
        host.variables.set('Input', ownedArray([plan(() => 7n), plan(() => { throw new Error('replacement failed'); })]));
        try {
            host.execute('use tables');
            expect(() => host.execute('Rows .value = Input')).toThrowError('replacement failed');
            expect(host.variables.get('Rows')).toBe(initial);
            expect(formatValue(host.execute('Rows .value')!)).toBe('10 20');
        } finally { host.dispose(); }
    });

    it('demands one scalar before writing an Arrow cell, and rejects a computed array', () => {
        let calls = 0;
        const host = runtime();
        host.variables.set('Rows', parseCsvToArrow('value\n10\n20\n'));
        host.variables.set('Input', plan(() => { calls++; return 7n; }));
        try {
            host.execute('use tables\nRows 0 .value += Input');
            expect((host.variables.get('Rows') as RankArrowTable).cell(0, 0)).toBe(17n);
            expect(calls).toBe(1);
            host.variables.set('Input', plan(() => ownedArray([8n])));
            expect(() => host.execute('Rows 0 .value = Input')).toThrowError('a table cell holds one value');
            expect((host.variables.get('Rows') as RankArrowTable).cell(0, 0)).toBe(17n);
        } finally { host.dispose(); }
    });

    it.each([
        ['F = 2 fenwick', 'F 0 = Input', 'F 0', '7'],
        ['F = 2 fenwick', 'F 0 += Input', 'F 0', '7'],
        ['F = (array 1 2) segment +', 'F 0 = Input', 'F 0 1 query', '9'],
        ['F = (array 1 2) segment +', 'F 0 += Input', 'F 0 1 query', '10'],
        ['F = (array 1 2) segment +', 'F 0 1 = Input', 'F 0 1 query', '14'],
        ['F = (array 1 2) segment +', 'F 0 1 += Input', 'F 0 1 query', '17'],
    ])('completes the stored result for %s / %s', (setup, write, read, expected) => {
        let calls = 0;
        const host = runtime();
        host.variables.set('Input', plan(() => { calls++; return 7n; }));
        try {
            host.execute(`use algo\n${setup}\n${write}`);
            expect(formatValue(host.execute(read)!)).toBe(expected);
            expect(formatValue(host.execute(read)!)).toBe(expected);
            expect(calls).toBe(1);
        } finally { host.dispose(); }
    });

    it('completes a whole flat record before copying it to compact storage', () => {
        let calls = 0;
        const host = runtime();
        host.variables.set('Input', record(plan(() => { calls++; return 7n; })));
        try {
            host.execute('use sequences\nZero = record\n .value = 0\nend\nF = 2 Zero flat\nF 0 = Input');
            expect(host.variables.get('F')).toBeInstanceOf(FlatRecords);
            host.execute('Read = F 0\nRead .value = 99\nCopy = F copy\nCopy 0 .value += 1');
            expect(host.execute('F 0 .value')).toBe(7n);
            expect(host.execute('Copy 0 .value')).toBe(8n);
            expect(host.execute('F 1 .value')).toBe(0n);
            expect(calls).toBe(1);
        } finally { host.dispose(); }
    });
});
