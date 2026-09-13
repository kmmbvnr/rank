import { RankError } from '../errors.js';
import { derivedArray, ownedObject, readArrayItem } from '../array-storage.js';
import { mapSequence } from '../sequence.js';
import {
    isRankArray,
    isRankDate,
    isRankDuration,
    isRankSqliteExpression,
    isRankSqliteDatabase,
    isRankSequence,
    type RankDate,
    type RankDateTime,
    type RankDuration,
    type RankSqliteExpression,
    type RankValue,
} from '../value.js';
import { sqliteCalendar } from './sqlite.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export const datesModule: RuntimeModule = {
    date: () => native('date', 1, ([value]) => isRankSqliteExpression(value)
        ? { ...value, text: `date(${value.text})`, calendar: 'date', textual: true } as RankSqliteExpression
        : mapDates(value, 'date', parseDate)),
    datetime: () => native('datetime', 1, ([value]) => isRankSqliteExpression(value)
        ? value.calendar === 'date'
            ? { ...value, text: `datetime(${value.text})`, calendar: 'datetime',
                textual: true } as RankSqliteExpression
            : { ...value, calendar: 'datetime' } as RankSqliteExpression
        : mapDates(value, 'datetime', parseDateTime)),
    duration: () => native('duration', 1, ([value]) => isRankSqliteExpression(value)
        ? { ...value, duration: true, boolean: false, textual: false } as RankSqliteExpression
        : mapDates(value, 'duration', parseDuration)),
    year: () => component('year', value => BigInt(value.year), '%Y'),
    month: () => component('month', value => BigInt(value.month), '%m'),
    day: () => component('day', value => BigInt(value.day), '%d'),
    weekday: () => component('weekday', value => BigInt(weekday(value))),
    hour: () => timeComponent('hour', value => BigInt(value.hour)),
    minute: () => timeComponent('minute', value => BigInt(value.minute)),
    second: () => timeComponent('second', value => BigInt(value.second)),
    monthstart: () => monthBoundary('monthstart', 0),
    nextmonth: () => monthBoundary('nextmonth', 1),
    seconds: () => native('seconds', 1, ([value]) => {
        if (isRankSqliteExpression(value) && value.duration) {
            return { kind: 'sqlite-expression', table: value.table,
                text: value.text, params: value.params,
                boolean: false } as RankSqliteExpression;
        }
        if (!isRankDuration(value)) {
            throw new RankError('seconds expects a duration', 'TypeError');
        }
        return value.seconds;
    }, 0),
    calendar: () => native('calendar', [2, 3], values => {
        const [startValue, endValue] = values.slice(-2);
        const start = parseDate(startValue);
        const end = parseDate(endValue);
        if (values.length === 3) {
            if (!isRankSqliteDatabase(values[0])) {
                throw new RankError('calendar expects a SQLite database first', 'TypeError');
            }
            return sqliteCalendar(values[0], start, end);
        }
        const startTime = dateTime(start);
        const endTime = dateTime(end);
        const count = Math.max(0, Math.round((endTime - startTime) / 86400000) + 1);
        const rows = derivedArray([count], [], index => {
            const day = new Date(startTime + index * 86400000);
            return ownedObject(new Map([['date', {
                kind: 'date' as const, year: day.getUTCFullYear(),
                month: day.getUTCMonth() + 1, day: day.getUTCDate(),
            }]]));
        });
        Object.defineProperty(rows, 'columnNames', { value: ['date'] });
        return rows;
    }),
};

function monthBoundary(name: string, offset: 0 | 1): RankValue {
    return native(name, 1, ([value]) => {
        if (isRankSqliteExpression(value) && value.calendar) {
            const modifier = offset === 1 ? ", 'start of month', '+1 month'" : ", 'start of month'";
            return { kind: 'sqlite-expression', table: value.table,
                text: `datetime(${value.text}${modifier})`,
                params: value.params, boolean: false,
                calendar: 'datetime', textual: true } as RankSqliteExpression;
        }
        return mapDates(value, name, item => {
            if (!isRankDate(item)) {
                throw new RankError(`${name} expects a date or datetime`, 'TypeError');
            }
            const month = item.month + offset;
            const year = item.year + (month > 12 ? 1 : 0);
            if (year > 9999) throw new RankError(`${name} exceeds year 9999`, 'InvalidDate');
            return { kind: 'datetime', year, month: month > 12 ? 1 : month,
                day: 1, hour: 0, minute: 0, second: 0 } as RankDateTime;
        });
    });
}

function dateTime(value: RankDate): number {
    const day = new Date(0);
    day.setUTCFullYear(value.year, value.month - 1, value.day);
    day.setUTCHours(0, 0, 0, 0);
    return day.getTime();
}

function component(
    name: string, read: (value: RankDate | RankDateTime) => bigint, format?: string,
): RankValue {
    return native(name, 1, ([value]) => {
        if (isRankSqliteExpression(value) && value.calendar) {
            if (!format) throw new RankError(`${name} is unavailable for SQLite views`, 'TypeError');
            return { kind: 'sqlite-expression', table: value.table,
                text: `CAST(strftime('${format}', ${value.text}) AS INTEGER)`,
                params: value.params, boolean: false } as RankSqliteExpression;
        }
        if (!isRankDate(value)) throw new RankError(`${name} expects a date or datetime`, 'TypeError');
        return read(value);
    }, 0);
}

function timeComponent(name: string, read: (value: RankDateTime) => bigint): RankValue {
    return native(name, 1, ([value]) => {
        if (!isRankDate(value) || value.kind !== 'datetime') {
            throw new RankError(`${name} expects a datetime`, 'TypeError');
        }
        return read(value);
    }, 0);
}

function mapDates(value: RankValue, name: string, parse: (value: RankValue) => RankValue): RankValue {
    if (isRankSequence(value)) return mapSequence(value, name, parse);
    if (!isRankArray(value)) return parse(value);
    return derivedArray(value.shape, [value], index =>
        parse(readArrayItem(value, index)), true);
}

function parseDate(value: RankValue): RankDate {
    if (isRankDate(value)) {
        return { kind: 'date', year: value.year, month: value.month, day: value.day };
    }
    if (typeof value !== 'string') throw new RankError('date expects text or datetime', 'TypeError');
    const parts = DATE.exec(value);
    if (!parts) throw invalidDate(value);
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    validateCalendar(year, month, day, value);
    return { kind: 'date', year, month, day };
}

function parseDateTime(value: RankValue): RankDateTime {
    if (isRankDate(value)) {
        return value.kind === 'datetime' ? value : { kind: 'datetime',
            year: value.year, month: value.month, day: value.day,
            hour: 0, minute: 0, second: 0 };
    }
    if (typeof value !== 'string') throw new RankError('datetime expects text or date', 'TypeError');
    const parts = DATETIME.exec(value);
    if (!parts) throw invalidDate(value);
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const hour = Number(parts[4]);
    const minute = Number(parts[5]);
    const second = Number(parts[6]);
    validateCalendar(year, month, day, value);
    if (hour > 23 || minute > 59 || second > 59) throw invalidDate(value);
    return { kind: 'datetime', year, month, day, hour, minute, second };
}

function parseDuration(value: RankValue): RankDuration {
    if (isRankDuration(value)) return value;
    if (typeof value === 'bigint') return { kind: 'duration', seconds: value };
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
        return { kind: 'duration', seconds: BigInt(value) };
    }
    throw new RankError('duration expects integer seconds', 'TypeError');
}

function validateCalendar(year: number, month: number, day: number, source: string): void {
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
        throw invalidDate(source);
    }
}

function daysInMonth(year: number, month: number): number {
    if (month === 2) return leapYear(year) ? 29 : 28;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function leapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function weekday(value: RankDate | RankDateTime): number {
    const before = value.year - 1;
    const ordinal = before * 365 + Math.floor(before / 4)
        - Math.floor(before / 100) + Math.floor(before / 400)
        + DAYS_BEFORE_MONTH[value.month - 1]
        + (leapYear(value.year) && value.month > 2 ? 1 : 0) + value.day;
    return (ordinal - 1) % 7;
}

function invalidDate(value: string): RankError {
    return new RankError(`invalid date: ${value}`, 'InvalidDate', value);
}
