import { describe, expect, it, vi } from 'vitest';
import { Interpreter, type NativeFunction } from '../src/index.js';
import { run } from './support.js';

describe('unique followed by len', () => {
    it.each([
        'array 1 2 1 3 2',
        '0 till 0 array',
        'array 1.0 1.0 2.0 2.0',
        'array true false true',
        'array "a" "b" "a"',
        '1 to 10',
        'new queue',
        'new set',
    ])('matches separate operations for %s', source => {
        const setup = `use sequences\nuse algo\nV = ${source}\n`;
        expect(run(`${setup}V unique len`))
            .toBe(run(`${setup}U = V unique\nU len`));
    });

    it('skips intermediate unique results, including through aliases and trailing operations', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences\nu = unique\nn = len\nV = array 1 2 1 3');
        const unique = runtime.variables.get('u') as NativeFunction;
        const spy = vi.spyOn(unique, 'call');
        expect(runtime.execute('V u n + 10')).toBe(13n);
        expect(spy).not.toHaveBeenCalled();
        expect(runtime.execute('U = V u\nU n')).toBe(3n);
        expect(spy).toHaveBeenCalledOnce();
    });

    it('preserves structural keys', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences');
        const record = (x: bigint) => ({ kind: 'record' as const, types: new Map<string, string>(), entries: new Map([['x', x]]) });
        runtime.variables.set('V', { kind: 'array', shape: [3], items: [record(1n), record(1n), record(2n)] });
        const fused = runtime.execute('V unique len');
        expect(fused).toBe(runtime.execute('U = V unique\nU len'));
        expect(fused).toBe(2n);
    });

    it.each(['queue', 'stack', 'deque', 'set'])('counts a populated %s without mutating it', kind => {
        const insert = kind === 'set' ? 'add' : 'push';
        const setup = `use algo\nuse sequences\nV = new ${kind}\nV ${insert} 1\nV ${insert} 2\nV ${insert} 1\n`;
        expect(run(setup + 'V unique len')).toBe('2');
        expect(run(setup + 'N = V unique len\nV len')).toBe(kind === 'set' ? '2' : '3');
    });

    it('traverses a single-pass sequence once and preserves traversal errors', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences');
        let reads = 0;
        runtime.variables.set('V', { kind: 'sequence', plan: {
            name: 'input', size: { kind: 'unknown' }, singlePass: true,
            *iterate() { for (const item of [1n, 1n, 2n]) { reads++; yield item; } },
        } });
        expect(runtime.execute('V unique len')).toBe(2n);
        expect(reads).toBe(3);
        runtime.variables.set('V', { kind: 'sequence', plan: {
            name: 'broken', size: { kind: 'unknown' },
            *iterate() { yield 1n; throw new Error('input failed'); },
        } });
        expect(() => runtime.execute('V unique len')).toThrow('input failed');
    });

    it('keeps user functions named unique or len on the ordinary path', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences\nu = unique\nn = len\nfun X custom\n return 99\nend');
        const custom = runtime.variables.get('custom') as NativeFunction;
        runtime.variables.set('u', { ...custom, name: 'unique' });
        expect(() => runtime.execute('(array 1 1) u n')).toThrow();
        runtime.execute('u = unique');
        runtime.variables.set('n', { ...custom, name: 'len' });
        expect(runtime.execute('(array 1 1) u n')).toBe(99n);
    });

    it('preserves errors for noncollections', () => {
        for (const source of ['7', 'true']) {
            const setup = `use sequences\nV = ${source}\n`;
            const error = (suffix: string) => {
                try { run(setup + suffix); } catch (e) { return (e as Error).message; }
                throw new Error('expected failure');
            };
            expect(error('V unique len')).toBe(error('U = V unique\nU len'));
        }
    });

    it('preserves intrinsic rank on matrices', () => {
        const setup = 'use sequences\nV = (array 1 1 2 2) reshape 2 2\n';
        expect(run(setup + 'V unique len')).toBe(run(setup + 'U = V unique\nU len'));
        const ragged = 'use sequences\nV = (array 1 1 2 3) reshape 2 2\n';
        expect(() => run(ragged + 'V unique len')).toThrow(/rank results must have one shape/);
        expect(() => run(ragged + 'U = V unique\nU len')).toThrow(/rank results must have one shape/);
    });

    it('preserves text joining, including surrogate pairs formed by deduplication', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences');
        runtime.variables.set('V', 'X\ud800X\udc00');
        expect(runtime.execute('V unique len')).toBe(2n);
        expect(runtime.execute('V unique len')).toBe(runtime.execute('U = V unique\nU len'));
        expect(run('use sequences\n"😀a😀b" unique len')).toBe('3');
    });
});
