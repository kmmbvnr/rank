import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createReplSession } from '../src/repl-session.js';

describe('function result signatures', () => {
    it.each(['fun', 'memo'])('retains the integer result of recursive %s with a declared scalar rank', async keyword => {
        const session = createReplSession();
        const source = `${keyword} collatz N rank 0
 if N equal 1
  return 1
 elif N even
  N = N // 2
 else
  N = 3 * N + 1
 end
 return N collatz + 1
end`;
        try {
            await session.execute('use numbers', 0, [], 40, true);
            const result = await session.execute(source, 1, [], 40, true);
            expect(result.ok).toBe(true);
            expect(result.output.map(line => line.text).join(' ')).toBe('a → i');
            expect(session.preview(source, 40, true).valueSummary).toBe('a → i');
            expect((await session.execute('collatz', 2, [], 40, true)).output.map(line => line.text).join(' '))
                .toBe('a → i');
        } finally { session.dispose(); }
    });

    it.each([
        ['fun inc X\n return X + 1\nend', 'i → i ; c<i> → c<i>'],
        ['fun identity X\n return X\nend', 'a → a'],
        ['fun pair X\n return tuple X "label"\nend', 'a → tuple(a, text)'],
        ['fun answer X rank 0\n return 42\nend', 'a → i'],
        ['fun answer X rank 1\n return 42\nend', 'a → i'],
        ['fun add X Y\n return X + Y\nend', 'a a → a ; a: number ; c<a> a → c<a> ; a: number ; a c<a> → c<a> ; a: number'],
        ['fun countdown N\n for N greater 0\n  yield N\n  N -= 1\n end\nend', 'i → sequence<i>'],
    ])('shows the inferred signature for %s', async (source, signature) => {
        const session = createReplSession();
        try {
            const result = await session.execute(source, 0, [], 40, true);
            expect(result.ok).toBe(true);
            expect(result.output.map(line => line.text).join(' ')).toBe(signature);
            expect(session.preview(source).output.map(line => line.text).join(' ')).toBe(signature);
            expect(session.preview(source, 40, true).valueSummary).toBe(signature);
            const name = source.split(' ')[1];
            expect((await session.execute(name, 1, [], 40, true)).output.map(line => line.text).join(' ')).toBe(signature);
        } finally { session.dispose(); }
    });

    it('uses the builtin signature and still executes ordinary values', async () => {
        const session = createReplSession();
        try {
            const result = await session.execute('use numbers\nsqrt', 0, [], 40, true);
            expect(result.ok).toBe(true);
            expect(result.output.map(line => line.text).join(' ')).toContain('→ real');
            expect(result.output.map(line => line.text).join(' ')).not.toContain('<function');
            expect((await session.execute('9 sqrt', 1, [], 40, true)).output.map(line => line.text)).toEqual(['3']);
        } finally { session.dispose(); }
    });
});

it('does not cache example specialization as the general function contract', async () => {
    const session = createReplSession();
    const source = 'fun twice X\n return X + X\nend';
    const general = 'a → a ; a: number ; c<a> → c<a> ; a: number';
    try {
        await session.execute(source, 0, [], 40, true);
        for (const expression of ['1 twice', '1.5 twice', '2 twice']) {
            expect((await session.execute(expression, 1, [], 40, true)).ok).toBe(true);
            expect((await session.execute('twice', 2, [], 40, true)).output.map(row => row.text).join(' ')).toBe(general);
        }
        expect(session.preview(source, 40, true).valueSummary).toBe(general);
    } finally { session.dispose(); }
});

it('shows a compact four-parameter contract in a 40-column session without caching a call specialization', async () => {
    const session = createReplSession();
    const source = 'fun sum4 A B C D\n return ((A + B) + C) + D\nend';
    const general = 'a a a a → a ; a: number ; c<a> a a a → c<a> ; a: number ; a c<a> a a → c<a> ; a: number';
    try {
        expect((await session.execute(source, 0, [], 40, true)).output.map(row => row.text).join(' ')).toBe(general);
        expect((await session.execute('1 2 3 4 sum4', 1, [], 40, true)).output.map(row => row.text)).toEqual(['10']);
        expect((await session.execute('sum4', 2, [], 40, true)).output.map(row => row.text).join(' ')).toBe(general);
        expect(session.preview(source, 40, true).valueSummary).toBe(general);
    } finally { session.dispose(); }
});


it('keeps an exhausted general preview result unknown', async () => {
    const session = createReplSession();
    const source = 'fun f A B C D\n return A .value + ((B + C) + D)\nend';
    const general = 'a b c d → ?';
    try {
        expect((await session.execute(source, 0, [], 40, true)).output.map(row => row.text).join(' ')).toBe(general);
        expect(session.preview(source, 40, true).valueSummary).toBe(general);
        expect((await session.execute('f', 1, [], 40, true)).output.map(row => row.text).join(' ')).toBe(general);
    } finally { session.dispose(); }
});


it('infers functions after CLI options and a loop in the full notebook context', async () => {
    const session = createReplSession();
    const prefix = 'use cli\noption N integer = 42\nfor N greater 1\n N = 1\nend';
    const generator = 'fun factors N\n Rest = N\n D = 2\n for Rest greater 1\n  yield D\n  Rest = Rest // D\n end\nend';
    const inc = 'fun inc X\n return X + 1\nend';
    const file = [prefix, generator, inc].join('\n').split('\n');
    try {
        expect((await session.execute('use cli', 0, file, 40, true)).ok).toBe(true);
        expect((await session.execute('option N integer = 42', 1, file, 40, true)).ok).toBe(true);
        expect((await session.execute('for N greater 1\n N = 1\nend', 2, file, 40, true)).ok).toBe(true);
        expect((await session.execute(generator, 1, file, 40, true)).output.map(row => row.text).join(' '))
            .toBe('i → sequence<i>');
        expect((await session.execute(inc, 2, file, 40, true)).output.map(row => row.text).join(' '))
            .toBe('i → i ; c<i> → c<i>');
    } finally { session.dispose(); }
});

it('keeps an unproven fallback result unknown when notebook context cannot be parsed', async () => {
    const session = createReplSession();
    try {
        const result = await session.execute('fun inc X\n return X + 1\nend', 0,
            ['for Missing greater 1', ' Missing = 1', 'end'], 40, true);
        expect(result.output.map(row => row.text).join(' ')).toBe('a → ?');
    } finally { session.dispose(); }
});


it('infers the settled integer return of the Euler poker function before any call', async () => {
    const demo = readFileSync(new URL('../../../demos/euler/054_poker.ra', import.meta.url), 'utf8');
    const source = demo.slice(demo.indexOf('fun poker_wins'), demo.indexOf('rem Category')).trim();
    const session = createReplSession();
    try {
        await session.execute('Input = ""', 0, [], 40, true);
        const result = await session.execute(source, 1, demo.split('\n'), 40, true);
        expect(result.ok).toBe(true);
        expect(result.output.map(row => row.text).join(' ')).toBe('a → i');
        expect(session.preview(source, 40, true).valueSummary).toBe('a → i');
    } finally { session.dispose(); }
});

it.each([
    ['Wins = 0\n for Line in Hands\n  if Line\n   Wins += 1\n  end\n end\n return Wins', 'a → i'],
    ['Wins = 0.0\n for Line in Hands\n  Wins += 1.0\n end\n return Wins', 'a → r'],
    ['Wins = 0\n if Hands\n  return Hands\n end\n return Wins', 'a → ?'],
])('uses existing return-flow facts for unknown arguments: %s', async (body, signature) => {
    const session = createReplSession();
    try {
        const source = `fun count Hands\n ${body}\nend`;
        const result = await session.execute(source, 0, [], 40, true);
        expect(result.ok).toBe(true);
        expect(result.output.map(row => row.text).join(' ')).toBe(signature);
    } finally { session.dispose(); }
});


it('infers the boolean return of the Euler palindrome function before any call', async () => {
    const demo = readFileSync(new URL('../../../demos/euler/004_palproduct.ra', import.meta.url), 'utf8');
    const source = demo.slice(demo.indexOf('fun palindrome')).trim();
    const session = createReplSession();
    try {
        await session.execute('use sequences', 0, [], 40, true);
        await session.execute('Digits = 3', 0, [], 40, true);
        const result = await session.execute(source, 1, demo.split('\n'), 40, true);
        expect(result.ok).toBe(true);
        expect(result.output.map(row => row.text).join(' ')).toBe('a → boolean');
        expect(session.preview(source, 40, true).valueSummary).toBe('a → boolean');
        expect((await session.execute('9009 palindrome', 2, [], 40, true)).output.map(row => row.text)).toEqual(['true']);
        expect((await session.execute('9010 palindrome', 3, [], 40, true)).output.map(row => row.text)).toEqual(['false']);
    } finally { session.dispose(); }
});
