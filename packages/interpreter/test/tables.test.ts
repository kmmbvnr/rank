import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { MemoryIo, run } from './support.js';

describe('Rank tables', () => {
    it('numbers array rows in their current order inside select', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables', 'use sequences',
            'Rows = "[{\\"id\\":3},{\\"id\\":1},{\\"id\\":2}]" json',
            'Sorted = Rows sort by .id',
            'Out = Sorted select',
            '  .number = rownumber',
            '  .id = .id',
            'end',
        ].join('\n'));
        expect(formatValue(runtime.execute('Out .number')!)).toBe('1 2 3');
        expect(formatValue(runtime.execute('Out .id')!)).toBe('1 2 3');
    });

    it('ranks sorted array rows with gaps after ties', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables', 'use sequences',
            'Rows = "[{\\"hours\\":10},{\\"hours\\":30},{\\"hours\\":20},',
            '  {\\"hours\\":20}]" json',
            'Sorted = Rows sort by .hours descending',
            'Out = Sorted select',
            '  .hours = .hours',
            '  .rank = ranknumber',
            'end',
        ].join('\n'));
        expect(formatValue(runtime.execute('Out .hours')!)).toBe('30 20 20 10');
        expect(formatValue(runtime.execute('Out .rank')!)).toBe('1 2 2 4');
        expect(() => runtime.execute('Bad = Rows select\n  .rank = ranknumber\nend'))
            .toThrowError('requires sort by');
    });

    it('groups one and several fields into flat aggregate tables', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables', 'use stats', 'use numbers', 'use sequences',
            'Rows = "[{\\"store\\":1,\\"family\\":\\"A\\",\\"sales\\":2},',
            '  {\\"store\\":2,\\"family\\":\\"A\\",\\"sales\\":10},',
            '  {\\"store\\":1,\\"family\\":\\"A\\",\\"sales\\":4},',
            '  {\\"store\\":1,\\"family\\":\\"B\\",\\"sales\\":8}]" json',
            'One = Rows group by .store',
            'Two = Rows group by .store .family',
            'Means = Two select',
            '  .sales = .sales mean',
            '  .visits = count',
            'end',
            'Sums = One select',
            '  .sales = .sales sum',
            'end',
        ].join('\n'));
        expect(formatValue(runtime.execute('Means .store')!)).toBe('1 2 1');
        expect(formatValue(runtime.execute('Means .family')!)).toBe('A A B');
        expect(formatValue(runtime.execute('Means .sales')!)).toBe('3 10 8');
        expect(formatValue(runtime.execute('Means .visits')!)).toBe('2 1 1');
        expect(formatValue(runtime.execute('Sums .sales')!)).toBe('14 10');
    });

    it('left joins in left-row order and expands duplicate right keys', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables',
            'Left = "[{\\"id\\":1,\\"key\\":\\"a\\"},',
            '  {\\"id\\":2,\\"key\\":\\"b\\"},',
            '  {\\"id\\":3,\\"key\\":\\"a\\"}]" json',
            'Right = "[{\\"key\\":\\"a\\",\\"value\\":10},',
            '  {\\"key\\":\\"a\\",\\"value\\":20}]" json',
            'Joined = Left Right leftjoin by .key',
            'Inner = Left Right innerjoin by .key',
        ].join('\n'));
        expect(formatValue(runtime.execute('Joined .id')!)).toBe('1 1 2 3 3');
        expect(formatValue(runtime.execute('Joined .value default 0')!)).toBe('10 20 0 10 20');
        expect(formatValue(runtime.execute('Inner .id')!)).toBe('1 1 3 3');
    });

    it('keeps missing group keys together but never matches them in a join', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables', 'use stats',
            'Rows = "[{\\"key\\":\\"a\\",\\"value\\":2},',
            '  {\\"value\\":4},{\\"value\\":6}]" json',
            'Groups = Rows group by .key',
            'Means = Groups select',
            '  .value = .value mean',
            'end',
            'Left = "[{\\"key\\":\\"a\\",\\"id\\":1},',
            '  {\\"id\\":2},{\\"id\\":3}]" json',
            'Joined = Left Means leftjoin by .key',
        ].join('\n'));
        expect(formatValue(runtime.execute('Means .value')!)).toBe('2 5');
        expect(formatValue(runtime.execute('Means .key default "missing"')!))
            .toBe('a missing');
        expect(formatValue(runtime.execute('Joined .value default 0')!)).toBe('2 0 0');
    });

    it('keeps an all-missing aggregate cell available for default', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables', 'use stats', 'use numbers',
            'Rows = "[{\\"key\\":1},{\\"key\\":1,\\"value\\":4},',
            '  {\\"key\\":2}]" json',
            'Groups = Rows group by .key',
            'Means = Groups select',
            '  .value = .value mean',
            'end',
            'Sums = Groups select',
            '  .value = .value sum',
            'end',
        ].join('\n'));
        expect(formatValue(runtime.execute('Means .value default 0')!)).toBe('4 0');
        expect(formatValue(runtime.execute('Sums .value')!)).toBe('4 0');
    });

    it('keeps grouped table syntax separate from ordinary reductions', () => {
        expect(() => run([
            'use json', 'use tables', 'use numbers',
            'Rows = "[{\\"key\\":1,\\"value\\":2}]" json',
            'G = Rows group by .key',
            'G .value sum',
        ].join('\n'))).toThrowError('grouped tables require a select block');
    });

    it('counts rows separately from present cells in grouped select', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables', 'use sequences', 'use numbers', 'use stats',
            'Rows = "[{\\"key\\":1,\\"value\\":2},{\\"key\\":1},',
            '  {\\"key\\":2}]" json',
            'G = Rows group by .key',
            'Totals = G select',
            '  .visits = count',
            '  .present = .value count',
            '  .total = .value sum',
            '  .average = .value mean',
            'end',
        ].join('\n'));
        expect(formatValue(runtime.execute('Totals .visits')!)).toBe('2 1');
        expect(formatValue(runtime.execute('Totals .present')!)).toBe('1 0');
        expect(formatValue(runtime.execute('Totals .total')!)).toBe('2 0');
        expect(formatValue(runtime.execute('Totals .average default 0')!)).toBe('2 0');
    });

    it('keeps real missing keys distinct from rollup subtotal rows', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables', 'use numbers', 'use sequences',
            'Rows = "[{\\"facid\\":1,\\"slots\\":3},',
            '  {\\"facid\\":1,\\"month\\":7,\\"slots\\":2}]" json',
            'G = Rows rollup by .facid .month',
            'Totals = G select',
            '  .slots = .slots sum',
            'end',
            'Totals = Totals sort by .facid .month',
        ].join('\n'));
        expect(formatValue(runtime.execute('Totals .slots')!)).toBe('2 3 5 5');
        expect(formatValue(runtime.execute('Totals .facid default 0')!)).toBe('1 1 1 0');
        expect(formatValue(runtime.execute('Totals .month default 0')!)).toBe('7 0 0 0');
    });

    it('gives an empty rollup one zero-valued grand total', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables', 'use numbers', 'use sequences',
            'Rows = "[]" json',
            'G = Rows rollup by .facid .month',
            'Totals = G select',
            '  .slots = .slots sum',
            'end',
            'Totals = Totals sort by .facid .month',
        ].join('\n'));
        expect(formatValue(runtime.execute('Totals .slots')!)).toBe('0');
    });

    it('sorts absent table keys last in both directions', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables', 'use sequences',
            'Rows = "[{\\"key\\":2},{\\"key\\":1},{}]" json',
            'Asc = Rows sort by .key',
            'Desc = Rows sort by .key descending',
        ].join('\n'));
        expect(formatValue(runtime.execute('Asc .key default 0')!)).toBe('1 2 0');
        expect(formatValue(runtime.execute('Desc .key default 0')!)).toBe('2 1 0');
    });

    it('rejects duplicate non-key columns in relational joins', () => {
        expect(() => run([
            'use json', 'use tables',
            'A = "[{\\"k\\":1,\\"v\\":2}]" json',
            'B = "[{\\"k\\":1,\\"v\\":3}]" json',
            'A B leftjoin by .k',
        ].join('\n'))).toThrowError('duplicate non-key column .v');
    });

    it('joins differently named TPC-H keys without temporary columns', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables',
            'Orders = "[{\\"o_orderkey\\":1,\\"o_custkey\\":7},',
            '  {\\"o_orderkey\\":2,\\"o_custkey\\":8}]" json',
            'Customers = "[{\\"c_custkey\\":7,\\"c_name\\":\\"Ada\\"}]" json',
            'Result = Orders Customers innerjoin on .o_custkey equal .c_custkey',
        ].join('\n'));
        expect(formatValue(runtime.execute('Result .o_orderkey')!)).toBe('1');
        expect(formatValue(runtime.execute('Result .c_name')!)).toBe('Ada');
        expect(formatValue(runtime.execute('Result labels')!))
            .toBe('.o_orderkey .o_custkey .c_name');
    });

    it('matches every explicit key pair in a multi-column join', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables',
            'A = "[{\\"left_a\\":1,\\"left_b\\":2,\\"id\\":7},',
            '  {\\"left_a\\":1,\\"left_b\\":3,\\"id\\":8}]" json',
            'B = "[{\\"right_a\\":1,\\"right_b\\":2,\\"name\\":\\"yes\\"}]" json',
            'C = A B leftjoin on .left_a equal .right_a .left_b equal .right_b',
        ].join('\n'));
        expect(formatValue(runtime.execute('C .name default "no"')!)).toBe('yes no');
    });

    it('keeps self-join fields under short table aliases', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables',
            'Data = "[{\\"memid\\":1,\\"firstname\\":\\"Ada\\"},',
            '  {\\"memid\\":2,\\"firstname\\":\\"Bea\\",\\"recommendedby\\":1}]" json',
            'M = Data alias .m',
            'R = Data alias .r',
            'J = M R leftjoin on',
            '  .recommendedby equal .memid',
        ].join('\n'));
        expect(formatValue(runtime.execute('J .m .firstname')!)).toBe('Ada Bea');
        expect(formatValue(runtime.execute('J .r .firstname default ""')!)).toBe(' Ada');
        expect(() => runtime.execute('M M leftjoin by .memid'))
            .toThrowError('aliases must differ');
        expect(() => runtime.execute('M Data leftjoin by .memid'))
            .toThrowError('requires aliases on both sides');
    });

    it('selects named array columns lazily and leaves missing cells absent', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use json', 'use tables',
            'Rows = "[{\\"name\\":\\"Ada\\",\\"score\\":2},{\\"name\\":\\"Bea\\"}]" json',
            'Cols = record',
            '  .member = Rows .name',
            '  .points = Rows .score',
            'end',
            'Out = Rows select Cols',
        ].join('\n'));
        expect(formatValue(runtime.execute('Out labels')!)).toBe('.member .points');
        expect(formatValue(runtime.execute('Out .member')!)).toBe('Ada Bea');
        expect(formatValue(runtime.execute('Out .points default 0')!)).toBe('2 0');
        expect(formatValue(runtime.execute('Rows labels')!)).toBe('.name .score');
    });
    it('keeps CSV header order, including empty columns and empty tables', () => {
        const io = new MemoryIo({
            '/rows.csv': 'z,empty,a\n1,,2\n3,,4\n',
            '/empty.csv': 'z,empty,a\n',
        });
        const runtime = new Interpreter(undefined, { io });
        expect(formatValue(runtime.execute('use tables\nRows = "/rows.csv" csv\nRows labels')!))
            .toBe('.z .empty .a');
        expect(formatValue(runtime.execute('Empty = "/empty.csv" csv\nEmpty labels')!))
            .toBe('.z .empty .a');
    });

    it('unions ordinary table fields by first appearance', () => {
        expect(run('use json\nuse tables\nRows = "[{\\"b\\":1},{\\"a\\":2,\\"b\\":3}]" json\nRows labels'))
            .toBe('.b .a');
        expect(() => run('use tables\n(array 1) labels')).toThrowError('labels expects object rows');
        expect(() => run('use tables\n(array shape 1 1 fill 0) labels'))
            .toThrowError('labels expects a rank-1 table');
    });

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
            'Rows .age default 0',
        ].join('\n'))!)).toBe('37 0');
    });

    it('does not evaluate a column fallback when every CSV cell is present', () => {
        const io = new MemoryIo({ '/train.csv': 'age\n37\n28\n' });
        const runtime = new Interpreter(undefined, { io });
        expect(formatValue(runtime.execute([
            'use tables',
            'Rows = "/train.csv" csv',
            'Rows .age default 1 / 0',
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

    it('writes selected columns with their table headers', () => {
        const io = new MemoryIo({});
        const runtime = new Interpreter(undefined, { io });
        runtime.execute([
            'use json',
            'use tables',
            'Rows = "[{\\"id\\":1,\\"name\\":\\"Ada\\",\\"extra\\":9},',
            '  {\\"id\\":2,\\"name\\":\\"Lin\\",\\"extra\\":8}]" json',
            'Out = Rows (array .name .id)',
            'Out "/submission.csv" csv',
        ].join('\n'));
        expect(new TextDecoder().decode(io.file('/submission.csv')))
            .toBe('name,id\nAda,1\nLin,2\n');
    });

    it('rejects ambiguous selected-column CSV headers', () => {
        const runtime = new Interpreter(undefined, { io: new MemoryIo({}) });
        expect(() => runtime.execute([
            'use json',
            'use tables',
            'Rows = "[{\\"x\\":1}]" json',
            'Out = Rows (array .x .x)',
            'Out "/bad.csv" csv',
        ].join('\n'))).toThrowError('csv output columns must have unique names');
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
            'Fields = array shape 0 fill .x',
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

    it('adds and replaces table columns', () => {
        expect(run([
            'use json',
            'use tables',
            'Rows = "[{\\"x\\":1},{\\"x\\":2}]" json',
            'Rows .y = array 5 6',
            'Rows .x += 10',
            'Rows (array .x .y)',
        ].join('\n'))).toBe('11 5 12 6');
    });

    it('materializes a replacement before changing its source column', () => {
        expect(run([
            'use json',
            'use tables',
            'Rows = "[{\\"x\\":1},{}]" json',
            'Rows .x = Rows .x default 0',
            'Rows .x',
        ].join('\n'))).toBe('1 0');
    });

    it('validates a whole column assignment before mutating rows', () => {
        expect(() => run([
            'use json',
            'use tables',
            'Rows = "[{\\"x\\":1},2]" json',
            'Rows .y = 4',
        ].join('\n'))).toThrowError('table assignment expects object rows');
        expect(() => run([
            'use json',
            'use tables',
            'Rows = "[{\\"x\\":1},{\\"x\\":2}]" json',
            'Rows .y = array 4',
        ].join('\n'))).toThrowError('assignment shape mismatch: 2 and 1');
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
        expect(() => run([
            'use json',
            'Rows = "[{\\"x\\":1}]" json',
            'Rows .y = 2',
        ].join('\n'))).toThrowError('table column assignment requires: use tables');
    });
});
