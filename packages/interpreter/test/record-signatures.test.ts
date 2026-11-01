import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { argumentRankSignature, argumentSignature } from '../src/return-contract.js';
import { semanticValueSignature } from '../src/runtime/semantic-signature.js';
import { semanticValueType } from '../src/semantic-array-type.js';
import type { RankRecord, CollectionElementType } from '../src/value.js';

function assertKeys(record: RankRecord): void {
    for (const elements of [true, false]) {
        const expected = JSON.stringify(semanticValueType(record, elements));
        expect(semanticValueSignature(record, elements)).toBe(expected);
        expect(elements ? argumentSignature([record, 7n]) : argumentRankSignature([record, 7n]))
            .toBe(JSON.stringify([semanticValueType(record, elements), semanticValueType(7n, elements)]));
    }
}

it('keeps exact keys for nested records, tuples, arrays and escaped field names', () => {
    const nested: RankRecord = { kind: 'record', types: new Map(), entries: new Map([['value', 1n]]) };
    const record: RankRecord = { kind: 'record', types: new Map(), entries: new Map([
        ['z', { kind: 'tuple', items: [nested, 'text'] }],
        ['a\n"\\', { kind: 'array', shape: [2], items: [1n, 2n] }],
    ]) };
    assertKeys(record); assertKeys(record);
});

it('invalidates full keys after empty-array refinement and retains rank-only keys', () => {
    const r = new Interpreter();
    try {
        r.execute('R = record\n .items = array shape 0 fill .NA\nend');
        const value = r.variables.get('R') as RankRecord;
        const full = argumentSignature([value]), ranks = argumentRankSignature([value]);
        r.execute('R .items = array 1 2');
        expect(argumentSignature([value])).not.toBe(full);
        expect(argumentRankSignature([value])).toBe(ranks);
        assertKeys(value);
        expect(() => r.execute('R .items = array true')).toThrow();
        assertKeys(value);
    } finally { r.dispose(); }
});

it('observes nested record refinement through an alias', () => {
    const r = new Interpreter();
    try {
        r.execute('Inner = record\n .items = array shape 0 fill .NA\nend\nOuter = record\n .inner = Inner\nend');
        const outer = r.variables.get('Outer') as RankRecord, before = argumentSignature([outer]);
        r.execute('Inner .items = array 3');
        expect(argumentSignature([outer])).not.toBe(before);
        assertKeys(outer);
        expect(() => r.execute('Inner .items = array "x"')).toThrow();
    } finally { r.dispose(); }
});

it('checks live contract maps after same-size field replacement and reordering', () => {
    const r: RankRecord = { kind: 'record', types: new Map(), entries: new Map([['a', 1n]]) };
    assertKeys(r);
    const before = argumentSignature([r]);
    r.entries.delete('a'); r.entries.set('b', 1n);
    r.fieldContracts!.delete('a'); r.fieldContracts!.set('b', { type: 'integer' });
    expect(argumentSignature([r])).not.toBe(before); assertKeys(r);
    r.entries.set('c', 2n); r.fieldContracts!.set('c', { type: 'integer' });
    const ordered = argumentSignature([r]);
    const b = r.fieldContracts!.get('b')!; r.fieldContracts!.delete('b'); r.fieldContracts!.set('b', b);
    expect(argumentSignature([r])).toBe(ordered); assertKeys(r);
});

it('observes nested map changes without replacing its parent contract', () => {
    const child: RankRecord = { kind: 'record', types: new Map(), entries: new Map([['x', 1n]]) };
    const parent: RankRecord = { kind: 'record', types: new Map(), entries: new Map([['child', child]]) };
    assertKeys(parent); const before = argumentSignature([parent]);
    child.entries.set('x', 'text'); child.fieldContracts!.set('x', { type: 'text' });
    expect(argumentSignature([parent])).not.toBe(before); assertKeys(parent);
});

it('rechecks array/tuple contract children and preserves missing/limit filtering', () => {
    const r: RankRecord = { kind: 'record', types: new Map(), entries: new Map([['x', 1n]]) };
    assertKeys(r);
    const fields = new Map<string, CollectionElementType>([['a', { type: 'array', rank: 2,
        elements: [{ type: 'numeric-limit' }, { type: 'missing' }, { type: 'integer' }] }],
    ['tuple', { type: 'tuple', positions: [{ type: 'real' }, { type: 'array', rank: 1 }] }]]);
    r.fieldContracts!.set('x', { type: 'record', fields });
    assertKeys(r); const before = argumentSignature([r]);
    fields.set('a', { type: 'array', rank: 3, elements: [{ type: 'integer' }] });
    expect(argumentSignature([r])).not.toBe(before); assertKeys(r);
    fields.set('tuple', { type: 'tuple', positions: [{ type: 'text' }] }); assertKeys(r);
});

it('retains host tuple-reader demand during record-contract preparation', async () => {
    const { recordContract } = await import('../src/record-contract.js');
    let reads = 0;
    const tuple = { kind: 'tuple' as const, get items() { reads++; return [1n]; } };
    const value: RankRecord = { kind: 'record', types: new Map(), entries: new Map([['tuple', tuple]]) };
    recordContract(value); reads = 0;
    recordContract(value); expect(reads).toBe(1);
    assertKeys(value);
});

it('retains reads through host entry-map overrides', async () => {
    const { recordContract } = await import('../src/record-contract.js');
    let reads = 0;
    const entries = new Map([['x', 1n]]);
    Object.defineProperty(entries, 'get', { value(key: string) { reads++; return Map.prototype.get.call(this, key); } });
    const value: RankRecord = { kind: 'record', types: new Map(), entries };
    recordContract(value); reads = 0;
    recordContract(value); expect(reads).toBe(1);
    assertKeys(value);
});

it('does not speculatively read an accessor-backed record entry map', async () => {
    const { recordContract } = await import('../src/record-contract.js');
    let reads = 0;
    const entries = new Map([['x', 1n], ['y', 2n]]);
    const value: RankRecord = { kind: 'record', types: new Map(), get entries() { reads++; return entries; } };
    recordContract(value); reads = 0;
    recordContract(value); expect(reads).toBe(2);
    assertKeys(value);
});

it('preserves stable collation ties when Unicode field metadata is reordered', () => {
    const value: RankRecord = { kind: 'record', types: new Map(),
        entries: new Map<string, import('../src/value.js').RankValue>([['é', 1n], ['e\u0301', true]]) };
    assertKeys(value);
    const first = value.fieldContracts!.get('é')!;
    value.fieldContracts!.delete('é'); value.fieldContracts!.set('é', first);
    assertKeys(value);
});
