import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { MemoryIo } from './support.js';

const CSV = [
    'Id,Sex,Age,Fare,Alive',
    '1,male,22,7.25,true',
    '2,female,,71.5,false',
    '3,female,26,,true',
    '4,male,35,8.05,false',
].join('\n');

function session(extra: Record<string, string> = {}) {
    const io = new MemoryIo({ '/in.csv': CSV, ...extra });
    const runtime = new Interpreter(undefined, { io });
    runtime.execute('use tables\nuse stats\nuse sequences\nData = "/in.csv" csv');
    const show = (source: string) => formatValue(runtime.execute(source)!);
    return { io, runtime, show };
}

describe('column tables', () => {
    it('reads csv into a table with a length and typed columns', () => {
        const { show } = session();
        expect(show('Data')).toBe('<table 4 rows: .Id .Sex .Age .Fare .Alive>');
        expect(show('Data len')).toBe('4');
        expect(show('Data .Id')).toBe('1 2 3 4');
        expect(show('Data .Sex')).toBe('male female female male');
        expect(show('Data .Alive')).toBe('true false true false');
        expect(show('Data labels')).toBe('.Id .Sex .Age .Fare .Alive');
    });

    it('holds an absent cell as .NA, which default fills', () => {
        const { show, runtime } = session();
        expect(show('Data .Age default 0')).toBe('22 0 26 35');
        expect(show('Data .Age')).toBe('22 .NA 26 35');
        expect(show('Data .Age present')).toBe('true false true true');
        expect(runtime.execute('X = Data .Age\nX 1')).toBe(runtime.execute('.NA'));
        expect(show('Data .Age median')).toBe('26');
    });

    it('reads a row as a snapshot and a cell inside it', () => {
        const { show } = session();
        expect(show('Data 0 .Sex')).toBe('male');
        expect(show('Data 3 .Fare')).toBe('8.05');
        expect(() => show('Data 9')).toThrowError('table row out of bounds');
    });

    it('selects rows with a mask, indices or a range into a new table', () => {
        const { show } = session();
        expect(show('Data (Data .Sex equal "female")')).toBe('<table 2 rows: .Id .Sex .Age .Fare .Alive>');
        expect(show('Data (Data .Sex equal "female") .Id')).toBe('2 3');
        expect(show('Data (array 3 0) .Id')).toBe('4 1');
        expect(show('Data (0 till 2) .Id')).toBe('1 2');
    });

    it('projects columns into a named matrix', () => {
        const { show } = session();
        expect(show('M = Data (array .Id .Alive)\nM shape')).toBe('4 2');
        expect(show('M 1 1')).toBe('false');
        expect(() => show('Data (array .Id .Age)')).toThrowError('missing object key: Age');
    });

    it('replaces, adds and updates columns as new versions', () => {
        const { show } = session();
        show('Data .Age = Data .Age default 30');
        expect(show('Data .Age')).toBe('22 30 26 35');
        show('Data .Female = Data .Sex equal "female"');
        expect(show('Data .Female')).toBe('false true true false');
        show('Data .Id += 10');
        expect(show('Data .Id')).toBe('11 12 13 14');
        show('Data .Note = "x"');
        expect(show('Data .Note')).toBe('x x x x');
        expect(show('Data labels')).toBe('.Id .Sex .Age .Fare .Alive .Female .Note');
    });

    it('never lets a write show through another name', () => {
        const { show } = session();
        show('Copy = Data');
        show('Copy .Id = 0');
        expect(show('Data .Id')).toBe('1 2 3 4');
        expect(show('Copy .Id')).toBe('0 0 0 0');
    });

    it('keeps the caller table unchanged when a function writes to its argument', () => {
        const { show } = session();
        show('fun patched T\n  T .Age = T .Age default 1\n  return T\nend');
        show('Filled = Data patched');
        expect(show('Filled .Age')).toBe('22 1 26 35');
        expect(show('Data .Age default 0')).toBe('22 0 26 35');
    });

    it('writes one cell and copies only its column', () => {
        const { show } = session();
        show('Data 1 .Age = 40');
        expect(show('Data .Age')).toBe('22 40 26 35');
        show('Data 0 .Fare += 1');
        expect(show('Data .Fare default 0')).toBe('8.25 71.5 0 8.05');
        expect(() => show('Data 0 .Sex = 5')).toThrowError('cannot write integer into text column');
    });

    it('rejects a column of the wrong length and keeps the table', () => {
        const { show } = session();
        expect(() => show('Data .Bad = array 1 2')).toThrowError('assignment shape mismatch');
        expect(show('Data labels')).toBe('.Id .Sex .Age .Fare .Alive');
    });

    it('converts to object rows and back', () => {
        const { show } = session();
        show('Rows = Data array');
        show('Rows .Age = 99');
        expect(show('Rows 0 .Age')).toBe('99');
        expect(show('Data .Age default 0')).toBe('22 0 26 35');
        show('Back = Rows table');
        expect(show('Back .Age default 0')).toBe('99 99 99 99');
        expect(show('Back len')).toBe('4');
    });

    it('writes a table to csv, absent cells empty', () => {
        const { io, show } = session();
        show('Data "/out.csv" csv');
        expect(new TextDecoder().decode(io.file('/out.csv'))).toBe(`${CSV}\n`.replace('2,female,,71.5', '2,female,,71.5'));
        show('Data (array .Id .Sex) "/two.csv" csv');
        expect(new TextDecoder().decode(io.file('/two.csv'))).toBe('Id,Sex\n1,male\n2,female\n3,female\n4,male\n');
    });
});
