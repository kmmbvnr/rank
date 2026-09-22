import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { ByteArray } from '../src/bytes.js';
import { isRankBytes } from '../src/value.js';
import { MemoryIo, run } from './support.js';

describe('compact bytes', () => {
    it('constructs bytes from integer arrays and UTF-8 text without an import', () => {
        expect(run('(array 0 1 127 128 255) bytes')).toBe('0x00017f80ff');
        expect(run('(array shape 0 fill 0) bytes')).toBe('0x');
        expect(run('"Ä😀" bytes')).toBe('0xc384f09f9880');
        expect(run('"" bytes')).toBe('0x');
        expect(run('B = (array 1 2) bytes\nB bytes equal B')).toBe('true true');
        expect(run('A = array 1 2\nB = A bytes\nA 0 = 9\nB 0')).toBe('1');
    });

    it.each([
        ['1 bytes', 'rank-1 integer array'],
        ['(array shape 1 2 fill 0) bytes', 'rank-1 integer array'],
        ['(array 0 1.5) bytes', 'integer elements'],
        ['(array true) bytes', 'integer elements'],
        ['(array "0") bytes', 'integer elements'],
        ['(array (-1)) bytes', 'between 0 and 255'],
        ['(array 256) bytes', 'between 0 and 255'],
        ['(array 999999999999999999999) bytes', 'between 0 and 255'],
    ])('rejects invalid conversion: %s', (source, message) => {
        expect(() => run(source)).toThrow(message);
    });

    it.each([
        ['(array 0 255 1) bytes', '(array 0 255) bytes', 'true'],
        ['(array 0 255) bytes', '(array 0 255) bytes', 'true'],
        ['(array 0 255) bytes', '(array 0 254) bytes', 'false'],
        ['(array 0) bytes', '(array 0 0) bytes', 'false'],
        ['"" bytes', '"" bytes', 'true'],
        ['"A" bytes', '"" bytes', 'true'],
        ['"" bytes', '"A" bytes', 'false'],
    ])('checks the prefix of %s', (value, prefix, expected) => {
        expect(run(`use text\nB = ${value}\nP = ${prefix}\nB P startswith`)).toBe(expected);
    });

    it('rejects implicit mixing of bytes and text', () => {
        expect(() => run('use text\n"abc" ("a" bytes) startswith')).toThrow('startswith expects');
        expect(() => run('use text\n("abc" bytes) "a" startswith')).toThrow('startswith expects');
    });

    it('preserves text array broadcasting', () => {
        expect(run('use text\n"ab" (array "a" "b") startswith')).toBe('true false');
        expect(run('use text\n(array "ab" "bc") (array "a") startswith')).toBe('true false');
        expect(run('use text\nA = array shape 2 1\n "ab"\n "bc"\nend\nA (array "a" "b") startswith'))
            .toBe('true false false true');
        const runtime = new Interpreter();
        try {
            const result = runtime.execute('use text\nA = array shape 2 1\n "ab"\n "bc"\nend\nA (array "a" "b") startswith');
            expect(result).toMatchObject({ shape: [2, 2] });
        } finally {
            runtime.dispose();
        }
        expect(() => run('use text\n(array "a" "b") (array "a" "b" "c") startswith'))
            .toThrow('shape mismatch');
    });

    it('does not materialize Rank integer atoms to compare byte prefixes', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use text\nB = "abc" bytes\nP = "ab" bytes');
            for (const name of ['B', 'P']) {
                const value = runtime.variables.get(name)!;
                expect(isRankBytes(value)).toBe(true);
                Object.defineProperty(value, 'items', { get() { throw new Error('materialized bytes'); } });
            }
            expect(runtime.execute('B P startswith')).toBe(true);
        } finally {
            runtime.dispose();
        }
    });

    it('compares views at their byte offsets', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use text');
            runtime.variables.set('B', new ByteArray(new Uint8Array([99, 0, 255, 1]).subarray(1)));
            runtime.variables.set('P', new ByteArray(new Uint8Array([88, 0, 255]).subarray(1)));
            expect(runtime.execute('B P startswith')).toBe(true);
        } finally {
            runtime.dispose();
        }
    });

    it('hashes binary input without text decoding and works with file I/O', () => {
        const io = new MemoryIo({ '/binary': '' });
        const runtime = new Interpreter(undefined, { io });
        try {
            runtime.execute('use io\nuse text\nuse crypto\nB = (array 0 128 255) bytes');
            expect(runtime.execute('B md5 hex')).toBe(createHash('md5').update(new Uint8Array([0, 128, 255])).digest('hex'));
            runtime.execute('File = "/binary" .write open\nFile B writebytes\nFile close');
            expect(io.files.get('/binary')).toEqual(new Uint8Array([0, 128, 255]));
            expect(runtime.execute('Header = "/binary" 0 3 readbytes\nHeader ((array 0 128) bytes) startswith')).toBe(true);
            expect(runtime.variables.get('Header')).toBeInstanceOf(ByteArray);
        } finally {
            runtime.dispose();
        }
    });
});
