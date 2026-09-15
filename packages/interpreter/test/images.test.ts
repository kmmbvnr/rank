import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { MemoryIo, run } from './support.js';

describe('image module', () => {
    it('returns filename rows and an RGB tensor through host decoding', () => {
        class ImageIo extends MemoryIo {
            listImages() { return [{ name: 'a.png', path: '/a.png' }]; }
            resizeImages(paths: readonly string[], height: number, width: number) {
                expect(paths).toEqual(['/a.png']);
                expect([height, width]).toEqual([1, 2]);
                return Uint8Array.from([1, 2, 3, 4, 5, 6]);
            }
        }
        const runtime = new Interpreter(undefined, { io: new ImageIo({}) });
        runtime.execute('use images\nuse sequences\nuse tables\nRows = "/x" images');
        expect(formatValue(runtime.execute('Rows .name')!)).toBe('a.png');
        const tensor = runtime.execute('Rows 1 2 resize')!;
        expect(tensor).toMatchObject({ kind: 'array', shape: [1, 1, 2, 3] });
        expect(formatValue(runtime.execute('(Rows 1 2 resize) (array 1 6) reshape')!))
            .toBe('1 2 3 4 5 6');
    });

    it('checks table, dimension and host errors', () => {
        expect(() => run('use images\n"/x" images'))
            .toThrowError('image access is unavailable in this host');
        expect(() => run('use images\n(array 1) 1 1 resize'))
            .toThrowError('resize expects image rows with text paths');
        expect(() => run('use images\n(array shape 0 fill 0) 0 1 resize'))
            .toThrowError('resize dimensions must be positive integers');
    });
});
