import { expect, it } from 'vitest';
import { FieldContracts, flatFieldRevision } from '../src/field-contracts.js';

it('versions runtime field metadata without invalidating unchanged contracts', () => {
    const fields = new FieldContracts(), integer = { type: 'integer' };
    const empty = flatFieldRevision(fields);
    fields.set('x', integer); const first = flatFieldRevision(fields);
    expect(first).not.toBe(empty);
    fields.set('x', integer); expect(flatFieldRevision(fields)).toBe(first);
    fields.set('x', { type: 'integer' }); expect(flatFieldRevision(fields)).toBe(first);
    fields.set('x', { type: 'array', rank: 1 }); expect(flatFieldRevision(fields)).not.toBe(first);
    expect(fields.delete('absent')).toBe(false);
    const before = flatFieldRevision(fields); fields.clear(); expect(flatFieldRevision(fields)).not.toBe(before);
    const cleared = flatFieldRevision(fields); fields.clear(); expect(flatFieldRevision(fields)).toBe(cleared);
});

it('declines the flat shortcut for live maps nested in arrays and tuples', () => {
    const fields = new FieldContracts();
    fields.set('rows', { type: 'array', rank: 1, elements: [{ type: 'record', fields: new Map() }] });
    expect(flatFieldRevision(fields)).toBeUndefined();
    fields.set('other', { type: 'tuple', positions: [{ type: 'record', fields: new Map() }] });
    fields.delete('rows'); expect(flatFieldRevision(fields)).toBeUndefined();
    fields.delete('other'); expect(flatFieldRevision(fields)).toBeDefined();
    fields.set('opaque', { type: 'record' }); expect(flatFieldRevision(fields)).toBeUndefined();
    expect(flatFieldRevision(new Map([['x', { type: 'integer' }]]))).toBeUndefined();
});
