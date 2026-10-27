import { describe, it, expect } from 'vitest';
import { compileRam, encodeRamWeights, decodeRamWeights, Interpreter } from '../src/index.js';
const source = 'use ml\noption X .f32 shape 1 2\noption W .f32 shape 2 1 = "weights.rwt"\nreturn X W linear';
describe('binary RAM weights', () => {
    it('checks shape, dtype, size, checksum and finite values', () => {
        const bytes = encodeRamWeights([2, 1], [1, -2]);
        expect(decodeRamWeights(bytes, [2, 1])).toEqual([1, -2]);
        expect(() => decodeRamWeights(bytes, [1, 2])).toThrow('shape');
        expect(() => decodeRamWeights(bytes.subarray(0, -1), [2, 1])).toThrow('size');
        const corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1;
        expect(() => decodeRamWeights(corrupt, [2, 1])).toThrow('checksum');
        const dtype = bytes.slice(); dtype[8 + 11] = 54;
        expect(() => decodeRamWeights(dtype, [2, 1])).toThrow();
        expect(() => encodeRamWeights([1], [Infinity])).toThrow('finite');
        expect(() => compileRam(source.replace('weights.rwt', '../weights.rwt'), 'model.ram', () => bytes)).toThrow('attachment name');
        expect(() => compileRam(source, 'model.ram')).toThrow('unavailable');
    });
    it('reuses the graph until source or attachment content changes', () => {
        let bytes = encodeRamWeights([2, 1], [1, -2]); const graphs: unknown[] = [];
        const interpreter = new Interpreter(() => {}, {
            loadModule: id => ({ id, source, readBinary: () => bytes }),
            ramGpu: graph => { graphs.push(graph); return [0]; },
        });
        interpreter.execute('use "model.ram"\nX = array shape 1 2 fill 1.0\nX model');
        interpreter.execute('X model');
        expect(graphs[0]).toBe(graphs[1]);
        bytes = encodeRamWeights([2, 1], [3, -2]);
        interpreter.execute('X model');
        expect(graphs[2]).not.toBe(graphs[0]);
        bytes[bytes.length - 1] ^= 1;
        expect(() => interpreter.execute('X model')).toThrow('checksum');
    });
});
