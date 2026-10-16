import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { analyzeBindings, analyzeValues, createRankServices, isFunctionStatement,
    isOperationAssignmentStatement, type Program } from '../src/index.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const parse = (source: string) => {
    const result = parser.parse<Program>(source);
    expect(result.parserErrors).toEqual([]);
    return result.value;
};

describe('operation assignment resolution', () => {
    it('resolves imported writes before function parameter scopes are prepared', () => {
        const program = parse('use cli\nName = "HOST"\nenv Name = "value"\ne = env\ne Name = "other"');
        expect(program.statements.filter(isOperationAssignmentStatement)).toHaveLength(2);
        const facts = analyzeBindings(program);
        expect(facts.scopes.flatMap(scope => scope.bindings).filter(binding => binding.kind === 'parameter')).toEqual([]);
        const name = facts.scopes.flatMap(scope => scope.bindings).find(binding => binding.name === 'Name')!;
        expect(name.reads).toHaveLength(2);
        expect(analyzeValues(program).diagnostics).toEqual([]);
    });
    it('requires explicit declarations and reports unsupported writes', () => {
        expect(isFunctionStatement(parse('fun Name env = Name').statements[0])).toBe(true);
        const diagnostics = analyzeValues(parse('use numbers\nabs Name = 1')).diagnostics;
        expect(diagnostics.some(diagnostic => /does not support addressed assignment/.test(diagnostic.message))).toBe(true);
    });
    it('checks write signatures independently of the read signature', () => {
        expect(analyzeValues(parse('use cli\nHost = "HOST" env')).bindings.get('Host')?.types)
            .toEqual(expect.arrayContaining(['text', 'missing']));
        expect(analyzeValues(parse('use cli\nenv "HOST" = 123')).diagnostics.some(diagnostic => /incompatible/.test(diagnostic.message))).toBe(true);
        expect(analyzeValues(parse('use cli\nenv "HOST" = .NA')).diagnostics).toEqual([]);
        expect(analyzeValues(parse('use cli\nenv "HOST" += "x"')).diagnostics.some(diagnostic => /compound/.test(diagnostic.message))).toBe(true);
    });
    it('keeps declarations constant and function-expression bindings replaceable', () => {
        expect(analyzeValues(parse('fun X fixed\n return X\nend\nfixed = abs')).diagnostics.some(diagnostic => /function declaration/.test(diagnostic.message))).toBe(true);
        expect(analyzeValues(parse('f = abs\nf = sqrt')).diagnostics).toEqual([]);
        const inline = analyzeValues(parse('f = abs'));
        expect(analyzeValues(parse('f = sqrt'), inline.bindings, inline.functions).diagnostics).toEqual([]);
    });
});
