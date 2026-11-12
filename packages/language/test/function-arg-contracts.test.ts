import { describe, expect, it } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createRankServices, functionArgContracts, functionArgDiagnostics, functionScopeDiagnostics, isFunctionStatement, type Program } from '../src/index.js';

const services = createRankServices(EmptyFileSystem).Rank;
const parse = parseHelper<Program>(services);

async function program(source: string): Promise<Program> {
    const document = await parse(source);
    expect(document.parseResult.parserErrors.map(error => error.message)).toEqual([]);
    return document.parseResult.value;
}

describe('arg contracts inside fun', () => {
    it('parses type, array, shape and default', async () => {
        const value = await program('fun X f Y\n  arg X real shape 2 3\n  arg Y integer array\n  return X\nend');
        const definition = value.statements.find(isFunctionStatement)!;
        const [x, y] = functionArgContracts(definition);
        expect([x.name, x.valueType, x.dimensions.map(item => item.value)]).toEqual(['X', 'real', [2n, 3n]]);
        expect([y.name, y.many]).toEqual(['Y', true]);
        expect(functionArgDiagnostics(value)).toEqual([]);
    });

    it('collects only the leading run', async () => {
        const value = await program('fun X f\n  arg X integer\n  Z = 1\n  return X\nend');
        expect(functionArgContracts(value.statements.find(isFunctionStatement)!)).toHaveLength(1);
    });

    it.each([
        ['fun X f\n  arg Y integer\n  return X\nend', 'function f has no parameter Y'],
        ['fun X f\n  arg X integer\n  arg X integer\n  return X\nend', 'arg X is declared twice'],
        ['fun X f\n  Z = 1\n  arg X integer\n  return X\nend', 'arg X must come first in the body of function f'],
        ['fun X f\n  if true\n    arg X integer\n  end\n  return X\nend', 'arg X must come first'],
        ['fun X f Y\n  arg Y integer = 2\n  return X\nend', 'takes its default from a call group'],
    ])('reports %j', async (source, message) => {
        const value = await program(source);
        expect(functionArgDiagnostics(value).map(item => item.message).join('\n')).toContain(message);
        expect(functionScopeDiagnostics(value).map(item => item.message).join('\n')).toContain(message);
    });

    it('does not count an inner function declaration against the outer body', async () => {
        const value = await program('fun X outer\n  fun Y inner\n    arg Y integer\n    return Y\n  end\n  return X inner\nend');
        expect(functionArgDiagnostics(value)).toEqual([]);
    });

    it('leaves top-level arg alone', async () => {
        const value = await program('use cli\narg Limit integer = 10\narg Grid real shape 2 2');
        expect(functionArgDiagnostics(value)).toEqual([]);
    });
});
