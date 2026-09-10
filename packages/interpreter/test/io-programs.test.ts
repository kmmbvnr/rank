import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, isRankSequence } from '../src/index.js';
import { MemoryIo, TokenInput, run } from './support.js';

describe('Rank IO, modules and programs', () => {
    it('calls operations after their data', () => {
        expect(run('use numbers\n54 24 gcd')).toBe('6');
        expect(run('use numbers\n8 12 lcm')).toBe('24');
        expect(run('use ranges\nuse numbers\n(1 to 10) lcm')).toBe('2520');
        expect(run('use numbers\n7 0 13 powmod')).toBe('1');
        expect(run('use numbers\n7 4 13 powmod')).toBe('9');
        expect(run('use numbers\n-2 3 5 powmod')).toBe('2');
        expect(run('use numbers\n9 0 1 powmod')).toBe('0');
        expect(() => run('use numbers\n2 (-1) 5 powmod'))
            .toThrowError('powmod exponent must be nonnegative');
        expect(() => run('use numbers\n2 3 0 powmod'))
            .toThrowError('powmod modulus must be positive');
        expect(() => run('use numbers\ngcd 54 24'))
            .toThrowError('operation must follow its data: gcd');
    });

    it('uses function arity to group an addressed first argument', () => {
        expect(run([
            'M = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'fun above Value Limit',
            '  return Value greater Limit',
            'end',
            'M 1 0 2 above',
        ].join('\n'))).toBe('true');
        expect(() => run([
            'fun add A B',
            '  return A + B',
            'end',
            '1 2 3 add',
        ].join('\n'))).toThrowError('add expects 2 arguments, got 3');
    });

    it('rejects names from modules that were not imported', () => {
        expect(() => run('sum 1')).toThrowError(RankError);
        expect(() => run('sum 1')).toThrowError('unknown name: sum');
    });

    it('sends print output through an injected function', () => {
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line));
        expect(formatValue(interpreter.execute('use io\n42 print')!)).toBe('42');
        expect(lines).toEqual(['42']);
    });

    it('reads word and integer tokens from standard input', () => {
        const interpreter = new Interpreter(undefined, {
            input: new TokenInput(['Rank', '-1203', '+7']),
        });
        expect(interpreter.execute([
            'use io',
            'Word = stdin .word',
            'A = stdin .integer',
            'B = stdin .integer',
            'array Word (A + B)',
        ].join('\n'))).toEqual({ kind: 'array', items: ['Rank', -1196n], shape: [2] });

        expect(() => new Interpreter(undefined, {
            input: new TokenInput([]),
        }).execute('use io\nstdin .integer')).toThrowError('standard input ended before .integer');
        expect(() => new Interpreter(undefined, {
            input: new TokenInput(['12x']),
        }).execute('use io\nstdin .integer')).toThrowError('invalid integer input: 12x');
        expect(() => new Interpreter(undefined, {
            input: new TokenInput(['1']),
        }).execute('stdin .integer')).toThrowError('stdin requires: use io');
        expect(() => new Interpreter(undefined, {
            input: new TokenInput(['x']),
        }).execute('use io\nstdin .line')).toThrowError('unsupported standard input mode: .line');
    });

    it('reads a counted standard-input sequence lazily and once', () => {
        const input = new TokenInput(['10', '20', 'tail']);
        const interpreter = new Interpreter(undefined, { input });
        interpreter.execute([
            'use io',
            'Values = stdin .integer 2',
        ].join('\n'));

        expect(input.reads).toBe(0);
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values) && values.plan.size)
            .toEqual({ kind: 'exact', value: 2n });
        expect(interpreter.execute('Values array'))
            .toEqual({ kind: 'array', items: [10n, 20n], shape: [2] });
        expect(input.reads).toBe(2);
        expect(() => interpreter.execute('Values array'))
            .toThrowError('standard input sequence .integer has already been consumed');
        expect(interpreter.execute('stdin .word 1 array'))
            .toEqual({ kind: 'array', items: ['tail'], shape: [1] });

        expect(new Interpreter(undefined, {
            input: new TokenInput([]),
        }).execute('use io\nstdin .word 0 array'))
            .toEqual({ kind: 'array', items: [], shape: [0] });
        expect(() => new Interpreter(undefined, {
            input: new TokenInput([]),
        }).execute('use io\nstdin .integer (-1)'))
            .toThrowError('stdin count must be a nonnegative integer');
        expect(() => new Interpreter(undefined, {
            input: new TokenInput([]),
        }).execute('use io\nstdin .integer 1.5'))
            .toThrowError('stdin count must be a nonnegative integer');

        const short = new Interpreter(undefined, { input: new TokenInput(['1']) });
        short.execute('use io\nValues = stdin .integer 2');
        expect(() => short.execute('Values array'))
            .toThrowError('standard input ended before .integer');

        const invalid = new Interpreter(undefined, { input: new TokenInput(['x']) });
        invalid.execute('use io\nValues = stdin .integer 1');
        expect(() => invalid.execute('Values array'))
            .toThrowError('invalid integer input: x');
    });

    it('runs user generator functions lazily and once', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'fun values N',
            '  Current = N',
            '  for Current greater 0',
            '    yield Current',
            '    Current -= 1',
            '  end',
            'end',
            'Values = 3 values',
        ].join('\n'));
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values)).toBe(true);
        if (!values || !isRankSequence(values)) return;
        expect(formatValue(values)).toBe('3 2 1');
        expect(() => formatValue(values))
            .toThrowError('generator sequence values has already been consumed');
    });

    it('materializes a finite sequence with postfix array', () => {
        expect(run([
            'fun values N',
            '  for N greater 0',
            '    yield N',
            '    N -= 1',
            '  end',
            'end',
            'Values = 3 values array',
            'Values',
        ].join('\n'))).toBe('3 2 1');
        expect(run([
            'fun none N',
            '  if N greater 0',
            '    yield N',
            '  end',
            'end',
            '0 none array',
        ].join('\n'))).toBe('');
        expect(() => run('use sequences\nprimes array'))
            .toThrowError('cannot materialize an infinite sequence');
        expect(() => run('42 array'))
            .toThrowError('postfix array expects a sequence');
    });

    it('supports bare return and preserves yielded array values', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'fun first Value',
            '  yield Value',
            '  return',
            '  yield 99',
            'end',
            'Values = (array 1 2) first',
        ].join('\n'));
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values)).toBe(true);
        if (!values || !isRankSequence(values)) return;
        const yielded = values.plan.iterate().next();
        expect(yielded.done).toBe(false);
        expect(yielded.value).toMatchObject({ kind: 'array', shape: [2] });
    });

    it('rejects return values in generators when execution reaches them', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'fun invalid N',
            '  yield N',
            '  return N',
            'end',
            'Values = 1 invalid',
        ].join('\n'));
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values)).toBe(true);
        if (!values || !isRankSequence(values)) return;
        expect(() => formatValue(values)).toThrowError('a generator cannot return a value');
        expect(() => run('fun invalid N\n  return\nend\n1 invalid'))
            .toThrowError('a value-returning function must return a value');
        expect(() => run('yield 1'))
            .toThrowError('yield is only valid inside a generator function');
    });

    it('defers generator errors until the failing element is requested', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'fun values N',
            '  yield N',
            '  yield 1 // 0',
            'end',
            'Values = 7 values',
        ].join('\n'));
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values)).toBe(true);
        if (!values || !isRankSequence(values)) return;
        const iterator = values.plan.iterate();
        expect(iterator.next()).toEqual({ value: 7n, done: false });
        expect(() => iterator.next()).toThrowError('division by zero');
    });

    it('closes generator resources when its consumer stops', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'fun positions Path',
            '  File = Path open',
            '  yield File position',
            '  yield File size',
            'end',
            'Values = "/input" positions',
        ].join('\n'));
        const values = interpreter.variables.get('Values');
        expect(values && isRankSequence(values)).toBe(true);
        if (!values || !isRankSequence(values)) return;
        const iterator = values.plan.iterate();
        expect(iterator.next()).toEqual({ value: 0n, done: false });
        expect(io.handles[0].closed).toBe(false);
        iterator.return?.();
        expect(io.handles[0].closed).toBe(true);
    });

    it('keeps resources owned by an escaping local function', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'fun reader Path',
            '  File = Path open',
            '  return take',
            '',
            '  fun take Count',
            '    return File Count readbytes',
            '  end',
            'end',
            'Take = "/input" reader',
            'Bytes = 2 Take',
        ].join('\n'));

        expect(formatValue(interpreter.variables.get('Bytes')!)).toBe('0x5261');
        expect(io.handles[0].closed).toBe(true);
    });

    it('reads and writes UTF-8 text through the host adapter', () => {
        const io = new MemoryIo({ '/input': 'one\r\ntwo\n' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'Text = "/input" read',
            'Lines = "/input" readlines',
            '"start" "/output" write',
            '" end" "/output" append',
        ].join('\n'));

        expect(interpreter.variables.get('Text')).toBe('one\r\ntwo\n');
        expect(formatValue(interpreter.variables.get('Lines')!)).toBe('one two');
        expect(new TextDecoder().decode(io.files.get('/output'))).toBe('start end');
    });

    it('decodes JSON values with exact integers and keyed objects', () => {
        const interpreter = new Interpreter();
        interpreter.execute([
            'use json',
            'use sequences',
            'Data = "{\\"huge\\":9007199254740993,\\"real\\":-2.5,\\"text\\":\\"A\\\\uD83D\\\\uDE00\\",\\"flag\\":true,\\"nothing\\":null,\\"items\\":[1,2]}" json',
            'Huge = Data "huge"',
            'Real = Data "real"',
            'Text = Data "text"',
            'Flag = Data "flag"',
            'Nothing = Data "nothing"',
            'Items = Data "items"',
            'RootType = Data type',
            'ItemsType = Items type',
            'NothingType = Nothing type',
            'HasHuge = "huge" in Data',
            'Count = Data len',
            'Keys = Data keys',
            '',
            'fun keys Object',
            '  Result = ""',
            '  for Value Key in Object',
            '    Result += Key',
            '  end',
            '  return Result',
            'end',
        ].join('\n'));

        expect(interpreter.variables.get('Huge')).toBe(9007199254740993n);
        expect(interpreter.variables.get('Real')).toBe(-2.5);
        expect(interpreter.variables.get('Text')).toBe('A😀');
        expect(interpreter.variables.get('Flag')).toBe(true);
        expect(interpreter.variables.get('Nothing')).toEqual({ kind: 'label', name: 'null' });
        expect(interpreter.variables.get('RootType')).toEqual({ kind: 'label', name: 'object' });
        expect(interpreter.variables.get('ItemsType')).toEqual({ kind: 'label', name: 'array' });
        expect(interpreter.variables.get('NothingType')).toEqual({ kind: 'label', name: 'symbol' });
        expect(interpreter.variables.get('HasHuge')).toBe(true);
        expect(interpreter.variables.get('Count')).toBe(6n);
        expect(interpreter.variables.get('Keys'))
            .toBe('hugerealtextflagnothingitems');
    });

    it('reports invalid JSON and rejects non-text input', () => {
        const interpreter = new Interpreter();
        expect(() => interpreter.execute('use json\n"{\\"value\\":]" json'))
            .toThrowError('invalid JSON: expected a JSON value at position 9');
        expect(() => interpreter.execute('use json\n42 json'))
            .toThrowError('json expects text');
    });

    it('reads byte ranges and seeks open files', () => {
        const io = new MemoryIo({ '/input': 'abcdef' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'Direct = "/input" 1 3 readbytes',
            'File = "/input" open',
            'First = File 2 readbytes',
            'File 3 seek',
            'Second = File 3 readbytes',
            'Offset = File position',
            'Length = File size',
            'Done = File eof',
        ].join('\n'));

        expect(formatValue(interpreter.variables.get('Direct')!)).toBe('0x626364');
        expect(formatValue(interpreter.variables.get('First')!)).toBe('0x6162');
        expect(formatValue(interpreter.variables.get('Second')!)).toBe('0x646566');
        expect(interpreter.variables.get('Offset')).toBe(6n);
        expect(interpreter.variables.get('Length')).toBe(6n);
        expect(interpreter.variables.get('Done')).toBe(true);
        expect(io.handles[0].closed).toBe(true);
    });

    it('writes bytes through write, update and append handles', () => {
        const io = new MemoryIo({ '/source': 'abc', '/output': 'old' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'Bytes = "/source" 0 3 readbytes',
            'Output = "/output" .write open',
            'Output Bytes writebytes',
            'Output flush',
            'Patch = "/source" 1 1 readbytes',
            'Update = "/output" .update open',
            'Update 1 seek',
            'Update Patch writebytes',
            'Tail = "/source" 2 1 readbytes',
            'Log = "/output" .append open',
            'Log Tail writebytes',
        ].join('\n'));

        expect(new TextDecoder().decode(io.files.get('/output'))).toBe('abcc');
        expect(io.handles.every(handle => handle.closed)).toBe(true);
    });

    it('supports explicit early close and rejects later file access', () => {
        const io = new MemoryIo({ '/input': 'abc' });
        const interpreter = new Interpreter(undefined, { io });
        expect(() => interpreter.execute([
            'use io',
            'File = "/input" open',
            'File close',
            'File 1 readbytes',
        ].join('\n'))).toThrowError('file is closed: /input');
        expect(io.handles[0].closed).toBe(true);
    });

    it('moves returned files into the caller resource scope', () => {
        const io = new MemoryIo({ '/input': 'abcdef' });
        const interpreter = new Interpreter(undefined, { io });
        interpreter.execute([
            'use io',
            'File = "/input" source',
            'File 2 seek',
            'Data = File 2 readbytes',
            '',
            'fun source Path',
            '  File = Path open',
            '  return File',
            'end',
        ].join('\n'));

        expect(formatValue(interpreter.variables.get('Data')!)).toBe('0x6364');
        expect(io.handles[0].closed).toBe(true);
    });

    it('closes owned files when execution raises an error', () => {
        const io = new MemoryIo({ '/input': 'abcdef' });
        const interpreter = new Interpreter(undefined, { io });
        expect(() => interpreter.execute([
            'use io',
            'File = "/input" open',
            '.Broken raise',
        ].join('\n'))).toThrowError('.Broken');
        expect(io.handles[0].closed).toBe(true);
    });

    it('resolves program inputs as workspace, args, then default', () => {
        const source = 'use cli\noption Limit integer = 1000\nLimit';
        expect(new Interpreter(undefined, { args: ['--limit', '20'] }).execute(source)).toBe(20n);

        const interpreter = new Interpreter(undefined, { args: ['--limit', '20'] });
        interpreter.variables.set('Limit', 10n);
        expect(interpreter.execute(source)).toBe(10n);
        expect(run(source)).toBe('1000');
    });

    it('loads an open program and runs it in the current workspace', () => {
        const interpreter = new Interpreter(undefined, {
            sourceId: '/tests/example_test.ra',
            loadModule: specifier => ({
                id: `/tests/${specifier}.ra`,
                source: 'use cli\noption Limit integer = 1000\nAnswer = Limit + 1',
            }),
        });
        expect(interpreter.execute('use "worker"\nLimit = 10\nrun\nAnswer')).toBe(11n);
    });

    it('runs a program through an explicit module alias', () => {
        const interpreter = new Interpreter(undefined, {
            loadModule: specifier => ({
                id: specifier,
                source: 'use cli\noption Limit integer = 1000\nAnswer = Limit + 1',
            }),
        });
        expect(interpreter.execute('use "worker" as W\nW.Limit = 20\nW.run\nW.Answer')).toBe(21n);
    });

    it('executes isolated Rank test blocks', () => {
        const interpreter = new Interpreter(undefined, {
            sourceId: '/tests/worker_test.ra',
            testing: true,
            loadModule: specifier => ({
                id: `/tests/${specifier}.ra`,
                source: 'use cli\noption Limit integer = 1000\nAnswer = Limit + 1',
            }),
        });
        interpreter.execute([
            'use testing',
            'test "workspace input"',
            '  use "worker"',
            '  Limit = 10',
            '  run',
            '  Answer equal 11',
            'end',
            'test "false result"',
            '  1 equal 2',
            'end',
            'test "matching arrays"',
            '  Answer = array 7 0 8',
            '  Answer equal array 7 0 8',
            'end',
            'test "different arrays"',
            '  Answer = array 7 0 8',
            '  Answer equal array 7 1 8',
            'end',
            'test "matching tensors"',
            '  Answer = array shape 2 2',
            '    1 2',
            '    3 4',
            '  end',
            '  Answer equal array shape 2 2',
            '    1 2',
            '    3 4',
            '  end',
            'end',
            'test "different shapes"',
            '  Answer = array shape 2 2',
            '    7 0',
            '    1 8',
            '  end',
            '  Answer equal array 7 0 8',
            'end',
        ].join('\n'));
        expect(interpreter.testResults).toEqual([
            { name: 'workspace input', passed: true, output: [] },
            {
                name: 'false result',
                passed: false,
                output: [],
                error: 'boolean test expression evaluated to false',
            },
            { name: 'matching arrays', passed: true, output: [] },
            {
                name: 'different arrays',
                passed: false,
                output: [],
                error: 'boolean test expression evaluated to false',
            },
            { name: 'matching tensors', passed: true, output: [] },
            {
                name: 'different shapes',
                passed: false,
                output: [],
                error: 'shape mismatch: 2,2 and 3',
            },
        ]);
    });

    it('compares a function-local queue with a rank-one array', () => {
        const interpreter = new Interpreter(undefined, { testing: true });
        interpreter.execute([
            'use testing',
            'test "queue result"',
            '  use algo',
            '  fun result Ignored',
            '    queue push 7',
            '    queue push 0',
            '    queue push 8',
            '    return queue',
            '  end',
            '  Answer = 0 result',
            '  Answer equal array 7 0 8',
            'end',
        ].join('\n'));
        expect(interpreter.testResults).toEqual([
            { name: 'queue result', passed: true, output: [] },
        ]);
    });

});
