import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function analyze(source: string) {
    const parsed = parser.parse<Program>(source + '\n');
    expect(parsed.parserErrors.map(error => error.message)).toEqual([]);
    return analyzeValues(parsed.value);
}
describe('tuple facts', () => {
    it('tracks arity and each position across function returns and unpacking', () => {
        const result = analyze('fun pair N\n return tuple N "x"\nend\nunpack X Y = 1 pair');
        expect(result.bindings.get('X')?.types).toEqual(['integer']);
        expect(result.bindings.get('Y')?.types).toEqual(['text']);
    });
    it('checks tuple return paths before a call', () => {
        for (const result of ['tuple 2 3', 'tuple 2']) {
            const analysis = analyze(`fun items Flag\n if Flag\n return tuple 1 "x"\n end\n return ${result}\nend`);
            expect(analysis.diagnostics.some(item => item.message.includes('returns incompatible tuple'))).toBe(true);
        }
    });
    it('checks unpacked names and tuple arity', () => {
        expect(analyze('unpack X Y = tuple 1 "x"\nunpack X Y = tuple 2 3').diagnostics
            .some(item => item.message.includes('Y') && item.message.includes('cannot receive'))).toBe(true);
        expect(analyze('unpack X Y = tuple 1').diagnostics.some(item => item.message.includes('expects 2 values'))).toBe(true);
    });
    it('checks homogeneous array literals', () => {
        expect(analyze('A = array 1 "x"').diagnostics.some(item => item.message.includes('one element type'))).toBe(true);
        expect(analyze('A = array 1 2.0').diagnostics.some(item => item.message.includes('one element type'))).toBe(true);
    });
});

it('retains recursive contracts of unpacked arrays', () => {
    const result = analyze('unpack X Y = tuple (array 1) "x"\nunpack X Y = tuple (array "bad") "y"');
    expect(result.diagnostics.some(item => item.message.includes('array elements'))).toBe(true);
});

it('distinguishes tuple indexing from unary operations', () => {
    const result = analyze('T = tuple 1 "x"\nN = T len\nV = T 0');
    expect(result.bindings.get('N')?.types).toEqual(['integer']);
    expect(result.bindings.get('V')?.types).toEqual(['integer']);
});

it('knows the two array ranks returned by eigh', () => {
    const result = analyze('use linalg\nM = array shape 2 2 fill 1.0\nunpack Values Vectors = M eigh');
    expect(result.bindings.get('Values')?.rank).toBe(1);
    expect(result.bindings.get('Vectors')?.rank).toBe(2);
});
