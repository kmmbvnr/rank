import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
function run(source: string) {
    const runtime = new Interpreter(() => {});
    try { return formatValue(runtime.execute('use sequences\n' + source)!); }
    finally { runtime.dispose(); }
}
const blocks = `fun blocks
 yield (array 1 2) reshape 1 2
 yield (array 3 4 5 6) reshape 2 2
end
`;
describe('concat unpack generator blocks', () => {
    it('joins unequal blocks without stacking them', () => {
        expect(run(blocks + "Parts' = blocks\nRows = concat unpack Parts\ntuple (Rows shape) Rows"))
            .toBe('3 2 1 2 3 4 5 6');
        expect(() => run(blocks + 'Parts = blocks')).toThrow('same shape');
    });
    it('supports axes, empty blocks and generator snapshots', () => {
        expect(run(`fun blocks
 A = (array 1 2) reshape 2 1
 yield A
 A 0 0 = 9
 yield A
 yield array shape 2 0 fill 0
end
Rows = concat unpack (blocks) axis 1
Rows`)).toBe('1 9 2 2');
    });
    it('consumes the source once', () => {
        expect(run(`fun blocks
 for I in 1 to 3
  yield array I
 end
end
Parts' = blocks
Rows = concat unpack Parts
First = Rows sum
Last = Rows sum
tuple First Last`)).toBe('6 6');
    });
    it('uses an explicit empty block to supply the shape of empty input', () => {
        const empty = 'fun empty\n if false\n  yield array 1\n end\nend\n';
        expect(run(empty + 'Rows = concat unpack (empty)\nRows shape')).toBe('0');
        expect(run(empty + 'Rows = concat (array shape 0 2 fill 0) unpack (empty)\nRows shape'))
            .toBe('0 2');
    });
    it('validates other dimensions and propagates generator errors', () => {
        expect(() => run('fun blocks\n yield array shape 1 2 fill 0\n yield array shape 1 3 fill 0\nend\nconcat unpack (blocks)'))
            .toThrow('non-concatenated axes');
        expect(() => run('fun blocks\n yield array 1\n yield 1 // 0\nend\nconcat unpack (blocks)')).toThrow();
    });
    it('does not broaden unrelated unpack forms', () => {
        expect(() => run(blocks + "Parts' = blocks\nstack unpack Parts"))
            .toThrow('unpack expects an array or tuple');
    });
    it('does not spread a large block list through the JavaScript call stack', () => {
        expect(run('fun blocks\n for I in 1 to 150000\n yield array I\n end\nend\nRows = concat unpack (blocks)\nRows len'))
            .toBe('150000');
    });
});
