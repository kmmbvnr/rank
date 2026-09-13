import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { MemoryIo, run } from './support.js';

describe('dates', () => {
    it('parses Gregorian dates and uses Monday-first weekdays', () => {
        expect(run('use dates\n(array "0001-01-01" "1900-03-01" "2000-02-29" "2024-01-07") date weekday'))
            .toBe('0 3 1 6');
        expect(run('use dates\n"2000-02-29" date year')).toBe('2000');
        expect(run('use dates\n"2000-02-29" date month')).toBe('2');
        expect(run('use dates\n"2000-02-29" date day')).toBe('29');
    });

    it('parses local datetimes with a space or T separator', () => {
        expect(run('use dates\n"2024-01-07 13:05:09" datetime hour')).toBe('13');
        expect(run('use dates\n"2024-01-07T13:05:09" datetime minute')).toBe('5');
        expect(run('use dates\n"2024-01-07T13:05:09" datetime second')).toBe('9');
        expect(run('use dates\n"2024-01-07T13:05:09" datetime weekday')).toBe('6');
        expect(run('use dates\nuse text\n"2024-01-07T13:05:09" datetime text'))
            .toBe('2024-01-07 13:05:09');
        expect(run('use dates\n"2024-01-07T13:05:09" datetime is .datetime'))
            .toBe('true');
    });

    it('casts dates to midnight datetimes without changing existing datetimes', () => {
        expect(run('use dates\n"2024-02-29" date datetime'))
            .toBe('2024-02-29 00:00:00');
        expect(run('use dates\n"2024-02-29 13:05:09" datetime date datetime'))
            .toBe('2024-02-29 00:00:00');
        expect(run('use dates\n"2024-02-29 13:05:09" datetime datetime'))
            .toBe('2024-02-29 13:05:09');
        expect(run('use dates\n"2024-02-29" date datetime is .datetime'))
            .toBe('true');
        expect(() => run('use dates\n1 datetime'))
            .toThrowError('datetime expects text or date');
    });

    it('casts date arrays lazily, tracks mutations and preserves shape', () => {
        expect(run([
            'use dates',
            'use sequences',
            'Dates = array shape 2 1',
            '  "2024-02-29"',
            '  "2024-03-01"',
            'end',
            'Times = Dates date datetime',
            'Times shape',
        ].join('\n'))).toBe('2 1');
        const runtime = new Interpreter();
        runtime.execute('use dates\nDates = array "2024-02-29"\nTimes = Dates date datetime');
        expect(formatValue(runtime.execute('Times 0')!)).toBe('2024-02-29 00:00:00');
        runtime.execute('Dates 0 = "2024-03-01"');
        expect(formatValue(runtime.execute('Times 0')!)).toBe('2024-03-01 00:00:00');
        expect(() => run('use dates\nDates = (array "2024-01-01" "bad") date datetime\nDates 1'))
            .toThrowError('invalid date: bad');
    });

    it('subtracts datetimes into exact signed durations', () => {
        expect(run([
            'use dates',
            'Start = "2024-02-28 23:59:59" datetime',
            'End = "2024-03-01 00:00:01" datetime',
            'Delta = End - Start',
            'Delta seconds',
        ].join('\n'))).toBe('86402');
        expect(run('use dates\nA = "2024-01-01 00:00:00" datetime\nA - A'))
            .toBe('00:00:00');
        expect(run('use dates\nA = "2024-01-01 00:00:00" datetime\nB = "2024-01-02 01:02:03" datetime\nA - B'))
            .toBe('-1 day 01:02:03');
        expect(run('use dates\nA = "2024-01-01 00:00:00" datetime\nA - A is .duration'))
            .toBe('true');
        expect(() => run('use dates\nA = "2024-01-02" date\nB = "2024-01-01" date\nA - B'))
            .toThrowError('- expects two datetimes');
        expect(() => run('use dates\n1 seconds'))
            .toThrowError('seconds expects a duration');
    });

    it('subtracts datetime arrays cellwise and keeps their shape', () => {
        expect(run([
            'use dates',
            'Starts = array shape 2 1',
            '  "2024-02-28 23:59:59"',
            '  "2024-03-01 00:00:00"',
            'end',
            'Ends = array shape 2 1',
            '  "2024-03-01 00:00:01"',
            '  "2024-02-29 23:59:59"',
            'end',
            'Start = Starts datetime',
            'End = Ends datetime',
            'D = End - Start',
            'D seconds',
        ].join('\n'))).toBe('86402 -1');
    });

    it('constructs and scales exact durations before adding them to datetimes', () => {
        expect(run('use dates\n1800 duration seconds')).toBe('1800');
        expect(run('use dates\n1800.0 duration seconds')).toBe('1800');
        expect(run('use dates\n1800 duration duration seconds')).toBe('1800');
        expect(run('use dates\nS = 1 to 3\nD = S duration\nD 2 seconds'))
            .toBe('3');
        expect(run('use dates\nSlot = 1800 duration\nSlot * 2 seconds'))
            .toBe('3600');
        expect(run('use dates\nSlot = 1800 duration\n2 * Slot seconds'))
            .toBe('3600');
        expect(run('use dates\nSlot = 1800 duration\nSlot * 0.5 seconds'))
            .toBe('900');
        expect(run('use dates\nStart = "2024-02-29 23:30:00" datetime\nSpan = 3600 duration\nStart + Span'))
            .toBe('2024-03-01 00:30:00');
        expect(run('use dates\nStart = "2024-03-01 00:30:00" datetime\nSpan = -3600 duration\nStart + Span'))
            .toBe('2024-02-29 23:30:00');
        expect(run('use dates\nStart = "2024-03-01 00:30:00" datetime\nSpan = 60 duration\nSpan + Start'))
            .toBe('2024-03-01 00:31:00');
        expect(() => run('use dates\n1.5 duration'))
            .toThrowError('duration expects integer seconds');
        expect(() => run('use dates\n1 duration * 0.5'))
            .toThrowError('* needs exact integer seconds');
        expect(() => run('use dates\nDay = "2024-01-01" date\nSpan = 1 duration\nDay + Span'))
            .toThrowError('+ expects a datetime and duration');
        expect(() => run('use dates\nStart = "9999-12-31 23:59:59" datetime\nSpan = 1 duration\nStart + Span'))
            .toThrowError('datetime exceeds years 0001 through 9999');
        expect(() => run('use dates\nStart = "0001-01-01 00:00:00" datetime\nSpan = -1 duration\nStart + Span'))
            .toThrowError('datetime exceeds years 0001 through 9999');
    });

    it('broadcasts duration arithmetic over lazy arrays and updates with source revisions', () => {
        const runtime = new Interpreter();
        runtime.execute([
            'use dates',
            'Starts = array "2024-02-29 23:30:00" "2024-03-01 00:00:00"',
            'Slots = array 2 1',
            'Slot = 1800 duration',
            'End = Starts datetime + Slots * Slot',
        ].join('\n'));
        expect(formatValue(runtime.execute('End')!))
            .toBe('2024-03-01 00:30:00 2024-03-01 00:30:00');
        runtime.execute('Slots 0 = 1');
        expect(formatValue(runtime.execute('End 0')!)).toBe('2024-03-01 00:00:00');
    });

    it('finds month boundaries for dates, datetimes and lazy arrays', () => {
        expect(run('use dates\n"2012-02-11" date monthstart'))
            .toBe('2012-02-01 00:00:00');
        expect(run('use dates\n"2012-02-11 23:59:59" datetime nextmonth'))
            .toBe('2012-03-01 00:00:00');
        expect(run('use dates\n"2012-12-31" date nextmonth'))
            .toBe('2013-01-01 00:00:00');
        expect(run('use dates\nDates = (array "2012-02-11" "bad") date\nBoundaries = Dates monthstart\nBoundaries 0'))
            .toBe('2012-02-01 00:00:00');
        expect(() => run('use dates\nDates = (array "2012-02-11" "bad") date\nBoundaries = Dates nextmonth\nBoundaries 1'))
            .toThrowError('invalid date: bad');
        expect(() => run('use dates\n"9999-12-31" date nextmonth'))
            .toThrowError('nextmonth exceeds year 9999');
        expect(() => run('use dates\n1 monthstart'))
            .toThrowError('monthstart expects a date or datetime');
        const runtime = new Interpreter();
        runtime.execute('use dates\nDates = array "2012-01-15"\nParsed = Dates date\nStarts = Parsed monthstart');
        expect(formatValue(runtime.execute('Starts 0')!)).toBe('2012-01-01 00:00:00');
        runtime.execute('Dates 0 = "2012-02-15"');
        expect(formatValue(runtime.execute('Starts 0')!)).toBe('2012-02-01 00:00:00');
    });

    it('preserves tensor shape and delays errors until a cell is read', () => {
        expect(run([
            'use dates',
            'Times = array shape 2 2',
            '  "2024-01-01" "2024-01-02"',
            '  "2024-01-03" "2024-01-07"',
            'end',
            'Result = Times date weekday',
            'Expected = array shape 2 2',
            '  0 1 2 6',
            'end',
            'Result equal Expected',
        ].join('\n'))).toBe('true true true true');
        expect(run('use dates\nDates = (array "2024-01-01" "bad") date\nDates 0 weekday'))
            .toBe('0');
        expect(() => run('use dates\nDates = (array "2024-01-01" "bad") date\nDates 1 weekday'))
            .toThrowError('invalid date: bad');
    });

    it('compares values, including in arrays and indexes', () => {
        expect(run('use dates\n"2024-01-01" date equal "2024-01-01" date')).toBe('true');
        expect(run('use dates\n"2024-01-01" date less "2024-01-02" date')).toBe('true');
        expect(run('use dates\n"2024-01-01 09:00:00" datetime less "2024-01-01 10:00:00" datetime'))
            .toBe('true');
        expect(run('use dates\nuse sequences\n(array "2024-01-01" "2024-01-01" "2024-01-02") date unique len'))
            .toBe('2');
        expect(run('use dates\nuse sequences\n(array "2024-01-02" "2024-01-01") date sort'))
            .toBe('2024-01-01 2024-01-02');
        expect(run('use dates\n"2024-01-01" date equal "2024-01-01 00:00:00" datetime'))
            .toBe('false');
        expect(run([
            'use dates',
            'use algo',
            'Key = "2024-01-01" date',
            'Lookup = new index',
            'Lookup Key = 42',
            'Lookup ("2024-01-01" date)',
        ].join('\n'))).toBe('42');
    });

    it('keeps original CSV text and formats explicit date values', () => {
        const io = new MemoryIo({ '/in.csv': 'when,value\n2024-01-07,1\n' });
        const runtime = new Interpreter(undefined, { io });
        runtime.execute([
            'use tables',
            'use dates',
            'Rows = "/in.csv" csv',
            'Rows .weekday = Rows .when date weekday',
            'Rows .parsed = Rows .when date',
            'Rows (array .when .weekday .parsed) "/out.csv" csv',
        ].join('\n'));
        expect(new TextDecoder().decode(io.file('/out.csv')))
            .toBe('when,weekday,parsed\n2024-01-07,6,2024-01-07\n');
        expect(formatValue(runtime.execute('Rows .when')!)).toBe('2024-01-07');
    });

    it('keeps table cells missing until explicitly padded', () => {
        const io = new MemoryIo({ '/in.csv': 'when,value\n2024-01-01,1\n,2\n2024-01-03,3\n' });
        const runtime = new Interpreter(undefined, { io });
        runtime.execute('use tables\nuse dates\nRows = "/in.csv" csv');
        expect(() => runtime.execute('Rows .when date weekday'))
            .toThrowError('missing object key: when');
        expect(formatValue(runtime.execute('(Rows .when pad "2024-01-02") date weekday')!))
            .toBe('0 1 2');
    });

    it('rejects invalid dates, times and operand types', () => {
        for (const invalid of ['2023-02-29', '1900-02-29', '0000-01-01', '2024-13-01', '2024-1-01', '2024-01-01Z']) {
            expect(() => run(`use dates\n"${invalid}" date`)).toThrowError('invalid date:');
        }
        for (const invalid of ['2024-01-01 24:00:00', '2024-01-01 23:60:00', '2024-01-01 23:59:60', '2024-01-01T10:00:00Z']) {
            expect(() => run(`use dates\n"${invalid}" datetime`)).toThrowError('invalid date:');
        }
        expect(() => run('use dates\n1 date')).toThrowError('date expects text');
        expect(() => run('use dates\n"2024-01-01" date hour'))
            .toThrowError('hour expects a datetime');
        expect(() => run('use dates\n"2024-01-01" weekday'))
            .toThrowError('weekday expects a date or datetime');
        expect(() => run('use dates\n"2024-01-01" date less "2024-01-01 00:00:00" datetime'))
            .toThrowError('ordered values must have one comparable type');
    });
});
