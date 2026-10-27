import { describe, expect, it } from 'vitest';
import { compileRam, ramRound, Interpreter } from '../src/index.js';

const hello = 'use ml\noption X .f16 shape 1 4\nreturn X relu\n';
describe('RAM ReLU MVP', () => {
    it('imports a callable graph and returns the host GPU result', () => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, {
            loadModule: name => ({ id: name, source: hello }),
            ramGpu: (graph, input) => {
                calls++;
                expect(graph.shape).toEqual([1, 4]);
                expect(new TextDecoder().decode(graph.model.subarray(4, 8))).toBe('TFL3');
                expect(input).toEqual([-2, 0, 1, 3]);
                return [0, 0, 1, 3];
            },
        });
        const value = runtime.execute('use sequences\nuse "hello.ram"\nX = (array -2.0 0.0 1.0 3.0) reshape 1 4\nX hello');
        expect(value).toMatchObject({ shape: [1, 4], items: [0, 0, 1, 3] });
        expect(calls).toBe(1);
    });
    it('supports aliases and recompiles changed attached source on the next call', () => {
        let source = hello;
        const runtime = new Interpreter(() => {}, {
            loadModule: name => ({ id: name, source }), ramGpu: (_graph, input) => input.map(n => Math.max(0, n)),
        });
        runtime.execute('use sequences\nuse "hello.ram" as M\nX = (array -2.0 0.0 1.0 3.0) reshape 1 4\nX M.hello');
        source = hello.replace('shape 1 4', 'shape 2 2');
        expect(() => runtime.execute('X M.hello')).toThrow('expects shape 2 2');
    });
    it('rejects unsupported graph bodies with a source location', () => {
        for (const source of [hello.replace('return X relu', 'return X + 1.0'), hello.replace('use ml', 'use io'),
            hello.replace('.f16', '.i8'), hello.replace('shape 1 4', 'shape 0 4')]) {
            expect(() => compileRam(source, 'hello.ram')).toThrow();
        }
        try { compileRam(hello.replace('return X relu', 'return X'), 'hello.ram'); }
        catch (error) { expect(error).toMatchObject({ location: { sourceId: 'hello.ram', line: 3 } }); }
    });
    it('requires a real GPU host and validates types before dispatch', () => {
        const runtime = new Interpreter(() => {}, { loadModule: name => ({ id: name, source: hello }) });
        runtime.execute('use sequences\nuse "hello.ram"\nX = (array -2.0 0.0 1.0 3.0) reshape 1 4');
        expect(() => runtime.execute('X hello')).toThrow('GPU runtime is unavailable');
        expect(() => runtime.execute('((array 1 2 3 4) reshape 1 4) hello')).toThrow('finite real');
        expect(() => runtime.execute('(array 1.0 2.0) hello')).toThrow('expects shape');
    });
    it('rejects malformed GPU outputs and f32 overflow', () => {
        for (const output of [[0], [0, NaN, 1, 3], [0, Infinity, 1, 3]]) {
            const runtime = new Interpreter(() => {}, {
                loadModule: name => ({ id: name, source: hello }), ramGpu: () => output,
            });
            expect(() => runtime.execute('use sequences\nuse "hello.ram"\n((array -2.0 0.0 1.0 3.0) reshape 1 4) hello'))
                .toThrow('Invalid GPU output');
        }
        expect(ramRound(1 + 2 ** -24, 'f32')).toBe(1);
        expect(() => ramRound(1e39, 'f32')).toThrow('outside .f32');
    });
    it('rounds binary16 ties to even and handles subnormals without silently overflowing', () => {
        expect(ramRound(1 + 2 ** -11, 'f16')).toBe(1);
        expect(ramRound(1 + 3 * 2 ** -11, 'f16')).toBe(1 + 2 ** -9);
        expect(ramRound(2 ** -25, 'f16')).toBe(0);
        expect(ramRound(3 * 2 ** -25, 'f16')).toBe(2 ** -23);
        expect(() => ramRound(65505, 'f16')).toThrow('outside .f16');
    });
});
