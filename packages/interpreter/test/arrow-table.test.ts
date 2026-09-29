import { describe, expect, it } from 'vitest';
import { parseCsvToArrow } from '../src/arrow-table.js';
import { parseCsv } from '../src/modules/tables.js';
import type { RankArray, RankObject } from '../src/value.js';

const rowsOf = (table: RankArray) => table.items.map(row => [...(row as RankObject).entries]);

const samples: Record<string, string> = {
    'mixed kinds and gaps': [
        'Id,Sex,Age,Fare,Alive,Note',
        '1,male,22,7.25,true,"a, b"',
        '2,female,,71.2833,false,',
        '3,female,26.5,,true,"say ""hi"""',
        '4,male,35,8.05,,x',
    ].join('\n'),
    'byte order mark and CRLF': '﻿a,b\r\n1,2\r\n3,4\r\n',
    'integers outside 64 bits stay exact': 'n\n123456789012345678901234567890\n-5\n',
    'repeating text': ['k,v', ...Array.from({ length: 40 }, (_, i) => `${i % 3 ? 'red' : 'blue'},${i}`)].join('\n'),
    'header only': 'a,b\n',
    'all empty column': 'a,b\n1,\n2,\n',
    'zero, sign and exponent forms': 'x\n0\n+3\n-0\n',
    'reals with exponents': 'x\n1e3\n2.5E-2\n.5\n',
    'text that only looks numeric': 'x\n007\n1_000\n',
    'blank line is a one-field record': 'a\n\n1\n',
    'lone carriage returns': 'a,b\r1,2\r3,4',
    'trailing comma at end of input': 'a,b\n1,',
    'quoted newline and empty quoted cell': 'a,b\n"x\ny",""\n',
    'numbers then text is one text column': ['k', '1', '2', ...Array.from({ length: 30 }, () => 'z'), ''].join('\n'),
    'mixed integer and real widen to real': 'x\n1\n2.5\n',
    'booleans need every cell': 'x\ntrue\nfalse\n\ntrue\n',
    'unicode text': ['k', ...Array.from({ length: 12 }, (_, i) => i % 2 ? 'Ünïcödé ✓' : '日本語')].join('\n'),
    'no trailing newline': 'a,b\n1,2',
};

describe('columnar CSV', () => {
    for (const [name, text] of Object.entries(samples)) {
        it(`matches the row-object reader: ${name}`, () => {
            const expected = parseCsv(text);
            const actual = parseCsvToArrow(text).toRows();
            expect(actual.shape).toEqual(expected.shape);
            expect(actual.columnNames).toEqual(expected.columnNames);
            expect(rowsOf(actual)).toEqual(rowsOf(expected));
        });
    }

    it('reads Python-style True and False as booleans', () => {
        const table = parseCsvToArrow('a,b\nTrue,yes\nFalse,True\n,false\n');
        expect(table.cell(0, 0)).toBe(true);
        expect(table.cell(1, 0)).toBe(false);
        expect(table.cell(2, 0)).toBeUndefined();
        expect(table.cell(0, 1)).toBe('yes');
    });

    it('reads a cell without building a row object', () => {
        const table = parseCsvToArrow('a,b\n1,x\n,y\n');
        expect(table.length).toBe(2);
        expect(table.cell(0, 0)).toBe(1n);
        expect(table.cell(1, 0)).toBeUndefined();
        expect(table.cell(1, 1)).toBe('y');
    });

    for (const [name, text, message] of [
        ['duplicate header', 'a,a\n1,2\n', 'duplicate CSV header: a'],
        ['empty header', 'a,\n1,2\n', 'CSV header must not be empty'],
        ['short row', 'a,b\n1,2\n3\n', 'CSV row 3 has 1 field, expected 2'],
        ['no input', '', 'CSV input must contain a header row'],
        ['stray quote', 'a,b\n1,x"y\n', 'unexpected quote in CSV field'],
        ['text after closing quote', 'a,b\n1,"x"y\n', 'unexpected character after quoted CSV field'],
        ['unterminated quote', 'a,b\n1,"x\n', 'unterminated quoted CSV field'],
        ['number out of range', 'a\n1e999\n', 'CSV number is outside supported range: 1e999'],
        ['range error before a later short row', 'a,b\n1e999,1\n2\n', 'CSV number is outside supported range: 1e999'],
        ['short row before a later range error', 'a,b\n1,1\n2\n1e999,1\n', 'CSV row 3 has 1 field, expected 2'],
        ['quote error beats an earlier short row', 'a,b\n1\n2,"x\n', 'unterminated quoted CSV field'],
        ['header error beats a short row', 'a,a\n1\n', 'duplicate CSV header: a'],
        ['long row', 'a\n1,2\n', 'CSV row 2 has 2 fields, expected 1'],
    ] as const) {
        it(`rejects like the row-object reader: ${name}`, () => {
            expect(() => parseCsv(text)).toThrowError(message);
            expect(() => parseCsvToArrow(text)).toThrowError(message);
        });
    }
});
