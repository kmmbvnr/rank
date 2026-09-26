import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('Rank records', () => {
    it('prints records with their fields and values', () => {
        const output: string[] = [];
        const interpreter = new Interpreter(line => output.push(line));
        const result = interpreter.execute([
            'use io',
            'Node = record',
            '  .value = 3',
            '  .name = "root"',
            'end',
            'Node print',
        ].join('\n'));
        expect(result).toBe(interpreter.variables.get('Node'));
        expect(output).toEqual(['{.value = 3, .name = root}']);
    });

    it('compares records structurally', () => {
        expect(run([
            'A = record',
            '  .point = array 2 3',
            '  .name = "same"',
            'end',
            'B = record',
            '  .name = "same"',
            '  .point = array 2 3',
            'end',
            'A equal B',
        ].join('\n'))).toBe('true');
        expect(run([
            'A = record',
            '  .value = 1',
            'end',
            'B = record',
            '  .value = 2',
            'end',
            'A equal B',
        ].join('\n'))).toBe('false');
    });

    it('orders records lexicographically in field declaration order', () => {
        const source = [
            'A = record',
            '  .num = 7',
            '  .den = 5',
            'end',
            'B = record',
            '  .num = 8',
            '  .den = 4',
            'end',
            'Same = record',
            '  .den = 5',
            '  .num = 7',
            'end',
            'Different = record',
            '  .num = 8',
            'end',
        ].join('\n');
        expect(run(source + '\nA equal Same')).toBe('true');
        expect(run(source + '\nA at least A and A at most A')).toBe('true');
        expect(run(source + '\nA less B')).toBe('true');
        expect(run(source + '\nB greater A')).toBe('true');
        expect(run(source + '\nA at most B')).toBe('true');
        expect(run(source + '\nB at least A')).toBe('true');
        expect(run(source + '\nA greater B')).toBe('false');
        expect(run(source + '\nuse sequences\nSorted = (array B A) sort\nSorted 0 equal A'))
            .toBe('true');
        expect(() => run(source + '\nA greater Same'))
            .toThrowError('ordered records must have the same fields in the same order');
        expect(() => run(source + '\nA greater Different'))
            .toThrowError('ordered records must have the same fields in the same order');
    });

    it('orders records with nested record fields', () => {
        expect(run([
            'A = record',
            '  .key = record',
            '    .major = 1',
            '    .minor = 2',
            '  end',
            'end',
            'B = record',
            '  .key = record',
            '    .major = 1',
            '    .minor = 3',
            '  end',
            'end',
            'A less B',
        ].join('\n'))).toBe('true');
    });

    it('uses structural record values in sets', () => {
        expect(run([
            'use algo',
            'use sequences',
            'A = record',
            '  .value = 1',
            '  .name = "same"',
            'end',
            'B = record',
            '  .name = "same"',
            '  .value = 1',
            'end',
            'set add A',
            'set add B',
            'B in set and set len equal 1',
        ].join('\n'))).toBe('true');
    });

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

    it('copies a record with changed fields', () => {
        expect(run([
            'State = record',
            '  .mana = 500',
            '  .boss = 50',
            '  .poison = 0',
            'end',
            'Next = State with',
            '  .mana -= 173',
            '  rem the comment keeps the block open',
            '  .poison = 6',
            'end',
            'Next .boss -= 3',
            'array (State .mana) (State .boss) (Next .mana) (Next .boss) (Next .poison)',
        ].join('\n'))).toBe('500 50 327 47 6');
    });

    it('checks the fields a record update changes', () => {
        const node = ['Node = record', '  .value = 1', 'end'];
        expect(() => run([...node, 'Copy = Node with', '  .other = 2', 'end'].join('\n')))
            .toThrowError('unknown record field: .other');
        expect(() => run([...node, 'Copy = Node with', '  .value = 2.0', 'end'].join('\n')))
            .toThrowError('record field .value has type integer and cannot receive real');
        expect(() => run([...node, 'Copy = Node with', '  .value = 2', '  .value += 1', 'end'].join('\n')))
            .toThrowError('duplicate record field: .value');
        expect(() => run(['Node = 1', 'Copy = Node with', '  .value = 2', 'end'].join('\n')))
            .toThrowError('with expects a record');
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
