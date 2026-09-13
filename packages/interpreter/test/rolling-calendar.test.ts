import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    return formatValue(new Interpreter().execute(source)!);
}

describe('calendar and trailing table groups', () => {
    it('generates inclusive Gregorian days and truncates datetimes', () => {
        expect(run('use dates\nuse tables\n"2024-02-28" "2024-03-01" calendar .date'))
            .toBe('2024-02-28 2024-02-29 2024-03-01');
        expect(run('use dates\nuse sequences\n"2024-03-01" "2024-02-28" calendar len'))
            .toBe('0');
        expect(run('use dates\n"2024-02-29 23:59:59" datetime date'))
            .toBe('2024-02-29');
        expect(() => run('use dates\n"2024-02-30" "2024-03-01" calendar'))
            .toThrow(/invalid date/);
    });

    it('keeps one ordered output per row and refreshes after a source write', () => {
        const runtime = new Interpreter();
        runtime.execute('use json\nuse tables\nuse numbers\nuse sequences\n'
            + 'Rows = "[{\\"date\\":\\"2024-01-03\\",\\"value\\":3},'
            + '{\\"date\\":\\"2024-01-01\\",\\"value\\":1},'
            + '{\\"date\\":\\"2024-01-02\\"}]" json\n'
            + 'W = Rows 2 rolling by .date\nOut = W select\n'
            + '  .total = .value sum\n  .present = .value count\nend');
        expect(formatValue(runtime.execute('Out .total')!)).toBe('1 1 3');
        expect(formatValue(runtime.execute('Out .present')!)).toBe('1 1 1');
        runtime.execute('Rows .value = 5');
        expect(formatValue(runtime.execute('Out .total')!)).toBe('5 10 10');
        expect(() => runtime.execute('Rows 0 rolling by .date'))
            .toThrow(/positive integer/);
    });
});
