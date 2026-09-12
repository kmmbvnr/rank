import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { MemoryIo, run } from './support.js';

describe('Rank tables', () => {
    it('reads typed CSV rows with quoted fields', () => {
        const io = new MemoryIo({
            '/train.csv': [
                'id,score,active,name,notes',
                '1,2.5,true,Ada,"first, row"',
                '2,-3,false,Lin,"two""quotes"""',
            ].join('\r\n'),
        });
        const runtime = new Interpreter(undefined, { io });
        runtime.execute('use tables\nRows = "/train.csv" csv');

        expect(formatValue(runtime.execute('Rows .id')!)).toBe('1 2');
        expect(formatValue(runtime.execute('Rows .score')!)).toBe('2.5 -3');
        expect(formatValue(runtime.execute('Rows .active')!)).toBe('true false');
        expect(formatValue(runtime.execute('Rows .name')!)).toBe('Ada Lin');
        expect(formatValue(runtime.execute('Rows .notes')!)).toBe('first, row two"quotes"');
    });

    it('infers one type for each CSV column and preserves leading zeroes', () => {
        const io = new MemoryIo({
            '/data.csv': 'code,measure,mixed\n001,2,3\n002,2.5,text\n',
        });
        const runtime = new Interpreter(undefined, { io });
        runtime.execute('use tables\nRows = "/data.csv" csv');
        expect(formatValue(runtime.execute('Rows .code')!)).toBe('001 002');
        expect(formatValue(runtime.execute('Rows .measure')!)).toBe('2 2.5');
        expect(formatValue(runtime.execute('Rows .mixed')!)).toBe('3 text');
    });

    it('pads empty CSV cells when the projected column is demanded', () => {
        const io = new MemoryIo({ '/train.csv': 'name,age\nAda,37\nLin,\n' });
        const runtime = new Interpreter(undefined, { io });
        expect(formatValue(runtime.execute([
            'use tables',
            'Rows = "/train.csv" csv',
            'Rows .age pad 0',
        ].join('\n'))!)).toBe('37 0');
    });

    it('does not evaluate a column fallback when every CSV cell is present', () => {
        const io = new MemoryIo({ '/train.csv': 'age\n37\n28\n' });
        const runtime = new Interpreter(undefined, { io });
        expect(formatValue(runtime.execute([
            'use tables',
            'Rows = "/train.csv" csv',
            'Rows .age pad 1 / 0',
        ].join('\n'))!)).toBe('37 28');
    });

    it('writes object rows as CSV and can read them back', () => {
        const io = new MemoryIo({});
        const runtime = new Interpreter(undefined, { io });
        runtime.execute([
            'use json',
            'use tables',
            'Rows = "[{\\"id\\":1,\\"name\\":\\"Ada, A.\\"},',
            '  {\\"id\\":2,\\"name\\":\\"Lin\\"}]" json',
            'Rows "/submission.csv" csv',
        ].join('\n'));
        expect(new TextDecoder().decode(io.file('/submission.csv')))
            .toBe('id,name\n1,"Ada, A."\n2,Lin\n');
        expect(formatValue(runtime.execute('Again = "/submission.csv" csv\nAgain .name')!))
            .toBe('Ada, A. Lin');
    });

    it('validates CSV headers and row widths', () => {
        const duplicate = new Interpreter(undefined, {
            io: new MemoryIo({ '/bad.csv': 'id,id\n1,2\n' }),
        });
        expect(() => duplicate.execute('use tables\n"/bad.csv" csv'))
            .toThrowError('duplicate CSV header: id');

        const short = new Interpreter(undefined, {
            io: new MemoryIo({ '/bad.csv': 'id,name\n1\n' }),
        });
        expect(() => short.execute('use tables\n"/bad.csv" csv'))
            .toThrowError('CSV row 2 has 1 field, expected 2');

        const quote = new Interpreter(undefined, {
            io: new MemoryIo({ '/bad.csv': 'id,name\n1,"Ada\n' }),
        });
        expect(() => quote.execute('use tables\n"/bad.csv" csv'))
            .toThrowError('unterminated quoted CSV field');
    });

    it('requires filesystem access for CSV', () => {
        expect(() => run('use tables\n"train.csv" csv'))
            .toThrowError('filesystem access is unavailable in this host');
    });

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

    it('selects an ordered list of columns as a matrix', () => {
        const runtime = new Interpreter();
        const result = runtime.execute([
            'use json',
            'use tables',
            'Rows = "[{\\"x\\":1,\\"y\\":2},{\\"x\\":3,\\"y\\":4}]" json',
            'Fields = array .y "x" .y',
            'Rows Fields',
        ].join('\n'))!;
        expect(result).toMatchObject({ kind: 'array', shape: [2, 3] });
        expect(formatValue(result)).toBe('2 1 2 4 3 4');
    });

    it('selects zero columns without demanding table rows', () => {
        const runtime = new Interpreter();
        const result = runtime.execute([
            'use json',
            'use tables',
            'Rows = "[1,2]" json',
            'Fields = array shape 0 pad .x',
            'Rows Fields',
        ].join('\n'))!;
        expect(result).toMatchObject({ kind: 'array', shape: [2, 0] });
        expect(formatValue(result)).toBe('');
    });

    it('validates field lists and demanded selected cells', () => {
        expect(() => run([
            'use json',
            'use tables',
            'Rows = "[{\\"x\\":1}]" json',
            'Rows (array .x 2)',
        ].join('\n'))).toThrowError('table column selection expects labels or text');
        expect(() => run([
            'use json',
            'use tables',
            'Rows = "[{\\"x\\":1}]" json',
            'Matrix = Rows (array .x .missing)',
            'Matrix 0 1',
        ].join('\n'))).toThrowError('missing object key: missing');
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
        expect(() => run([
            'use json',
            'Rows = "[{\\"x\\":1}]" json',
            'Rows (array .x)',
        ].join('\n'))).toThrowError('table column selection requires: use tables');
    });
});
