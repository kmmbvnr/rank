import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('Rank tables', () => {
    it('projects text and label fields while preserving shape', () => {
        expect(run([
            'use json',
            'use tables',
            'Rows = "[{\\"name\\":\\"Ada\\"},',
            '  {\\"name\\":\\"Lin\\"}]" json',
            'Rows "name"',
        ].join('\n'))).toBe('Ada Lin');
        expect(run([
            'use json',
            'use tables',
            'Rows = "[{\\"name\\":\\"Ada\\"}]" json',
            '(Rows .name) 0',
        ].join('\n'))).toBe('Ada');

        const result = new Interpreter().execute([
            'use json',
            'use sequences',
            'use tables',
            'Rows = "[{\\"x\\":1},{\\"x\\":2}]" json',
            'Matrix = Rows (array 1 2) reshape',
            'Matrix "x"',
        ].join('\n'));
        expect(result).toMatchObject({ kind: 'array', shape: [1, 2] });
    });

    it('participates in data-first function argument grouping', () => {
        expect(run([
            'use json',
            'use sequences',
            'use tables',
            'Rows = "[{\\"x\\":1},{\\"x\\":2}]" json',
            'Rows "x" len',
        ].join('\n'))).toBe('2');
    });

    it('checks rows and missing fields only when demanded', () => {
        expect(run([
            'use json',
            'use tables',
            'Rows = "[{\\"x\\":1},2]" json',
            'Column = Rows "x"',
            'Column 0',
        ].join('\n'))).toBe('1');
        expect(() => run([
            'use json',
            'use tables',
            'Rows = "[{\\"x\\":1},2]" json',
            'Column = Rows "x"',
            'Column 1',
        ].join('\n'))).toThrowError('table projection expects object rows');
        expect(() => run([
            'use json',
            'use tables',
            'Rows = "[{\\"x\\":1}]" json',
            'Column = Rows "missing"',
            'Column 0',
        ].join('\n'))).toThrowError('missing object key: missing');
    });

    it('requires the tables module', () => {
        expect(() => run([
            'use json',
            'Rows = "[{\\"x\\":1}]" json',
            'Rows "x"',
        ].join('\n'))).toThrowError('table projection requires: use tables');
    });
});
