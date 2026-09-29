import { describe, expect, it } from 'vitest';
import { parseCsvToArrow } from '../src/arrow-table.js';
import type { RankObject, RankValue } from '../src/value.js';

const rowsOf = (text: string) => parseCsvToArrow(text).toRows().items
    .map(row => Object.fromEntries((row as RankObject).entries));

interface Sample { text: string; names: string[]; rows: Record<string, RankValue>[] }

const repeating = Array.from({ length: 40 }, (_, i) => ({ k: i % 3 ? 'red' : 'blue', v: BigInt(i) }));
const unicode = Array.from({ length: 12 }, (_, i) => ({ k: i % 2 ? 'Ünïcödé ✓' : '日本語' }));

const samples: Record<string, Sample> = {
    'mixed kinds and gaps': {
        text: [
            'Id,Sex,Age,Fare,Alive,Note',
            '1,male,22,7.25,true,"a, b"',
            '2,female,,71.2833,false,',
            '3,female,26.5,,true,"say ""hi"""',
            '4,male,35,8.05,,x',
        ].join('\n'),
        names: ['Id', 'Sex', 'Age', 'Fare', 'Alive', 'Note'],
        rows: [
            { Id: 1n, Sex: 'male', Age: 22, Fare: 7.25, Alive: true, Note: 'a, b' },
            { Id: 2n, Sex: 'female', Fare: 71.2833, Alive: false },
            { Id: 3n, Sex: 'female', Age: 26.5, Alive: true, Note: 'say "hi"' },
            { Id: 4n, Sex: 'male', Age: 35, Fare: 8.05, Note: 'x' },
        ],
    },
    'byte order mark and CRLF': {
        text: '﻿a,b\r\n1,2\r\n3,4\r\n', names: ['a', 'b'],
        rows: [{ a: 1n, b: 2n }, { a: 3n, b: 4n }],
    },
    'integers outside 64 bits stay exact': {
        text: 'n\n123456789012345678901234567890\n-5\n', names: ['n'],
        rows: [{ n: 123456789012345678901234567890n }, { n: -5n }],
    },
    'repeating text': {
        text: ['k,v', ...repeating.map(row => `${row.k},${row.v}`)].join('\n'),
        names: ['k', 'v'], rows: repeating,
    },
    'header only': { text: 'a,b\n', names: ['a', 'b'], rows: [] },
    'all empty column': { text: 'a,b\n1,\n2,\n', names: ['a', 'b'], rows: [{ a: 1n }, { a: 2n }] },
    'zero, sign and exponent forms': {
        text: 'x\n0\n+3\n-0\n', names: ['x'], rows: [{ x: 0n }, { x: 3n }, { x: 0n }],
    },
    'reals with exponents': {
        text: 'x\n1e3\n2.5E-2\n.5\n', names: ['x'], rows: [{ x: 1000 }, { x: 0.025 }, { x: 0.5 }],
    },
    'text that only looks numeric': {
        text: 'x\n007\n1_000\n', names: ['x'], rows: [{ x: '007' }, { x: '1_000' }],
    },
    'blank line is a one-field record': { text: 'a\n\n1\n', names: ['a'], rows: [{}, { a: 1n }] },
    'lone carriage returns': {
        text: 'a,b\r1,2\r3,4', names: ['a', 'b'], rows: [{ a: 1n, b: 2n }, { a: 3n, b: 4n }],
    },
    'trailing comma at end of input': { text: 'a,b\n1,', names: ['a', 'b'], rows: [{ a: 1n }] },
    'quoted newline and empty quoted cell': {
        text: 'a,b\n"x\ny",""\n', names: ['a', 'b'], rows: [{ a: 'x\ny' }],
    },
    'numbers then text is one text column': {
        text: ['k', '1', '2', ...Array.from({ length: 30 }, () => 'z'), ''].join('\n'), names: ['k'],
        rows: [{ k: '1' }, { k: '2' }, ...Array.from({ length: 30 }, () => ({ k: 'z' }))],
    },
    'mixed integer and real widen to real': {
        text: 'x\n1\n2.5\n', names: ['x'], rows: [{ x: 1 }, { x: 2.5 }],
    },
    'booleans need every cell': {
        text: 'x\ntrue\nfalse\n\ntrue\n', names: ['x'], rows: [{ x: true }, { x: false }, {}, { x: true }],
    },
    'unicode text': {
        text: ['k', ...unicode.map(row => row.k)].join('\n'), names: ['k'], rows: unicode,
    },
    'no trailing newline': { text: 'a,b\n1,2', names: ['a', 'b'], rows: [{ a: 1n, b: 2n }] },
};

describe('columnar CSV', () => {
    for (const [name, sample] of Object.entries(samples)) {
        it(`reads ${name}`, () => {
            const table = parseCsvToArrow(sample.text);
            expect(table.length).toBe(sample.rows.length);
            expect(table.names).toEqual(sample.names);
            expect(rowsOf(sample.text)).toEqual(sample.rows);
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
        it(`rejects ${name}`, () => {
            expect(() => parseCsvToArrow(text)).toThrowError(message);
        });
    }
});
