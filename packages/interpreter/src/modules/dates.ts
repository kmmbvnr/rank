import { RankError } from '../errors.js';
import { derivedArray, ownedObject } from '../array-storage.js';
import { mapSequence } from '../sequence.js';
import {
    isRankArray,
    isRankDate,
    isRankSqliteExpression,
    isRankSqliteDatabase,
    isRankSequence,
    type RankArray,
    type RankDate,
    type RankDateTime,
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
        ? { ...value, calendar: 'datetime' } as RankSqliteExpression
        : mapDates(value, 'datetime', parseDateTime)),
    year: () => component('year', value => BigInt(value.year), '%Y'),
    month: () => component('month', value => BigInt(value.month), '%m'),
    day: () => component('day', value => BigInt(value.day), '%d'),
    weekday: () => component('weekday', value => BigInt(weekday(value))),
    hour: () => timeComponent('hour', value => BigInt(value.hour)),
    minute: () => timeComponent('minute', value => BigInt(value.minute)),
    second: () => timeComponent('second', value => BigInt(value.second)),
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
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    const cache = new Map<number, RankValue>();
    const itemAt = (index: number): RankValue => {
        const cached = cache.get(index);
        if (cached !== undefined) return cached;
        const result = parse(value.itemAt?.(index) ?? value.items[index]);
        cache.set(index, result);
        return result;
    };
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape: value.shape,
        itemAt,
        containsFiles: false,
        get items() {
            materialized ??= Array.from({ length: size }, (_, index) => itemAt(index));
            return materialized;
        },
    } as RankArray;
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
    if (typeof value !== 'string') throw new RankError('datetime expects text', 'TypeError');
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
