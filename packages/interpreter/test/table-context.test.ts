import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankArray } from '../src/index.js';
import { MemoryIo } from './support.js';

function setup() {
    const io = new MemoryIo({});
    const runtime = new Interpreter(undefined, { io });
    runtime.execute('use json\nuse tables\nuse sequences\nuse numbers\n'
        + 'Rows = "[{\\"id\\":1,\\"name\\":\\"B\\",\\"cost\\":10},'
        + '{\\"id\\":2,\\"name\\":\\"A\\",\\"cost\\":20},'
        + '{\\"id\\":3,\\"name\\":\\"B\\",\\"cost\\":20}]" json');
    return { runtime, io };
}

describe('contextual table operations', () => {
    it('composes filter, scoped calculations, select and mixed sorting without changing its input', () => {
        const { runtime } = setup();
        runtime.execute('Cost = 999\nSaved = Rows\nRows = Rows filter\n'
            + '  .id equal 1 or .id equal 2\n  .cost greater 10\nend\n'
            + 'Out = Rows select\n  Cost = .cost * 2\n'
            + '  .name = .name\n  .total = Cost\nend\n'
            + 'Out = Out sort by .total .descending .name .ascending');
        expect(formatValue(runtime.execute('Out .total')!)).toBe('40');
        expect(formatValue(runtime.execute('Cost')!)).toBe('999');
        expect(formatValue(runtime.execute('Saved .id')!)).toBe('1 2 3');
        expect(formatValue(runtime.execute('Rows .id')!)).toBe('2');
        expect(() => formatValue(runtime.execute('Saved .total')!)).toThrow(/missing object key/);
    });

    it('keeps select locals lexical inside functions and reads fields from the original input', () => {
        const { runtime } = setup();
        runtime.execute('fun prices R Cost\n'
            + '  Out = R select\n    Cost = .cost + Cost\n'
            + '    .cost = Cost\n    .original = .cost\n  end\n'
            + '  return Out\nend\nA = Rows 7 prices\nB = Rows 3 prices');
        expect(formatValue(runtime.execute('A .cost')!)).toBe('17 27 27');
        expect(formatValue(runtime.execute('B .cost')!)).toBe('13 23 23');
        expect(formatValue(runtime.execute('A .original')!)).toBe('10 20 20');
        expect(() => runtime.execute('Cost')).toThrow(/unknown name/);
    });

    it('expands field operands after ordinary call arity, leaving explicit receivers and label variables intact', () => {
        const { runtime } = setup();
        runtime.execute('Label = .tag\nOther = Rows\n'
            + 'Out = Rows select\n  Guest = .id equal 1\n'
            + '  .chosen = Guest .cost .id choose\n'
            + '  .explicit = Other .cost\n  .kind = Label\n'
            + '  .minimum = Other .cost .id min\n'
            + '  .lowest = (Other .cost) min\nend');
        expect(formatValue(runtime.execute('Out .chosen')!)).toBe('10 2 3');
        expect(formatValue(runtime.execute('Out .explicit')!)).toBe('10 20 20');
        expect(formatValue(runtime.execute('Out .kind')!)).toBe('.tag .tag .tag');
        expect(formatValue(runtime.execute('Out .minimum')!)).toBe('1 2 3');
        expect(formatValue(runtime.execute('Out .lowest')!)).toBe('10 10 10');
    });

    it('reads aliased field paths and preserves missing cells after a left join', () => {
        const { runtime } = setup();
        runtime.execute('M = Rows alias .m\nSmall = Rows filter .id less 3\n'
            + 'R = Small alias .r\nJ = M R leftjoin by .id\n'
            + 'Out = J select\n  .left = .m .name\n  .right = .r .name\nend');
        expect(formatValue(runtime.execute('Out .left')!)).toBe('B A B');
        expect(formatValue(runtime.execute('Out .right default "none"')!)).toBe('B A none');
    });

    it('keeps single-field results tabular, column order, empty headers and lazy source revisions', () => {
        const { runtime, io } = setup();
        runtime.execute('One = Rows select .name\nTwo = Rows select .name .id\n'
            + 'Empty = One filter .name equal "absent"\nEmpty "empty.csv" csv\n'
            + 'Rows .name = "Changed"');
        expect(isRankArray(runtime.variables.get('One')!)).toBe(true);
        expect(formatValue(runtime.execute('One .name')!)).toBe('Changed Changed Changed');
        expect(formatValue(runtime.execute('Two labels')!)).toBe('.name .id');
        expect(new TextDecoder().decode(io.files.get('empty.csv'))).toBe('name\n');
    });

    it('restores the outer scope on errors and rejects side effects before they execute', () => {
        const { runtime, io } = setup();
        runtime.execute('use io\nWriter = write\nCost = 9');
        expect(() => runtime.execute('Out = Rows select\n  Cost = 10\n'
            + '  .x = "oops" "oops.txt" Writer\nend')).toThrow(/pure standard-library/);
        expect(io.files.has('oops.txt')).toBe(false);
        expect(formatValue(runtime.execute('Cost')!)).toBe('9');
        expect(() => runtime.execute('Out = Rows select .id .id')).toThrow(/duplicate select field/);
        expect(() => runtime.execute('Out = Rows select\n  X = .id\nend')).toThrow(/at least one field/);
        expect(() => runtime.execute('Out = Rows select\n  X = 1\n  X = "bad"\n  .x = X\nend'))
            .toThrow(/cannot change type/);
        expect(() => runtime.execute('Out = Rows filter 1')).toThrow(/boolean mask/);
    });
});

describe('sort directions', () => {
    it('orders text and retains source positions for equal descending keys', () => {
        const { runtime } = setup();
        runtime.execute('Out = Rows sort by .cost .descending .name .ascending\n'
            + 'Order = Rows argsort by .cost .descending\n'
            + 'Text = "a😀b" sort .descending\n'
            + 'Ties = (array 2 1 2 1) argsort .descending');
        expect(formatValue(runtime.execute('Out .id')!)).toBe('2 3 1');
        expect(formatValue(runtime.execute('Order')!)).toBe('1 2 0');
        expect(formatValue(runtime.execute('Text')!)).toBe('😀ba');
        expect(formatValue(runtime.execute('Ties')!)).toBe('0 2 1 3');
    });

    it('supports function keys and tensor sort/argsort directions', () => {
        const { runtime } = setup();
        runtime.execute('fun cost R\n  return R .cost\nend\n'
            + 'Out = Rows sort by cost .descending\n'
            + 'M = array shape 2 3\n  3 1 2\n  0 5 4\nend\n'
            + 'S = M sort .descending\nI = M argsort axis 0 .descending\n'
            + 'R = M sort rank 1 .ascending');
        expect(formatValue(runtime.execute('Out .id')!)).toBe('2 3 1');
        expect(formatValue(runtime.execute('S')!)).toBe('3 2 1 5 4 0');
        expect(formatValue(runtime.execute('I')!)).toBe('0 1 1 1 0 0');
        expect(formatValue(runtime.execute('R')!)).toBe('1 2 3 0 4 5');
        expect(formatValue(runtime.execute('S shape')!)).toBe('2 3');
        expect(formatValue(runtime.execute('I shape')!)).toBe('2 3');
    });

    it('orders date keys and continues a pipeline after direction', () => {
        const { runtime } = setup();
        runtime.execute('use dates\nDates = (array "2020-01-02" "2020-01-01" "2020-01-02") date\n'
            + 'Rows .day = Dates\nR = Rows sort by .day .descending\n'
            + 'First = (array 1 3 2) sort .descending 0');
        expect(formatValue(runtime.execute('R .id')!)).toBe('1 3 2');
        expect(formatValue(runtime.execute('First')!)).toBe('3');
    });
});
