import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('Rank records', () => {
    it('constructs closed records and updates typed fields', () => {
        expect(run([
            'Node = record',
            '  .data = 2.0',
            '  .grad = 0.0',
            'end',
            'Node .grad += 3.0',
            'Node .data + Node .grad',
        ].join('\n'))).toBe('5');
    });

    it('passes records by reference', () => {
        expect(run([
            'fun accumulate Node Amount',
            '  Node .grad += Amount',
            '  return Node',
            'end',
            'Node = record',
            '  .grad = 0.0',
            'end',
            'Updated = Node 2.5 accumulate',
            'Node .grad equal Updated .grad',
        ].join('\n'))).toBe('true');
    });

    it('creates a fresh record each time', () => {
        expect(run([
            'fun make Value',
            '  Item = record',
            '    .value = Value',
            '  end',
            '  return Item',
            'end',
            'A = 1 make',
            'B = 2 make',
            'A .value = 3',
            'B .value',
        ].join('\n'))).toBe('2');
    });

    it('supports fields reached through another structure', () => {
        expect(run([
            'use algo',
            'Node = record',
            '  .grad = 0.0',
            'end',
            'Tape = queue',
            'Tape push Node',
            'Tape 0 .grad = 4.0',
            'Node .grad',
        ].join('\n'))).toBe('4');
    });

    it('rejects duplicate, unknown and changed-type fields', () => {
        expect(() => run([
            'Node = record',
            '  .value = 1',
            '  .value = 2',
            'end',
        ].join('\n'))).toThrowError('duplicate record field: .value');
        expect(() => run([
            'Node = record',
            '  .value = 1',
            'end',
            'Node .other = 2',
        ].join('\n'))).toThrowError('unknown record field: .other');
        expect(() => run([
            'Node = record',
            '  .value = 1',
            'end',
            'Node .value = 2.0',
        ].join('\n'))).toThrowError(
            'record field .value has type integer and cannot receive real',
        );
    });

    it('exposes record as a runtime type', () => {
        expect(run([
            'Node = record',
            '  .value = 1',
            'end',
            'Node is .record',
        ].join('\n'))).toBe('true');
    });
});
