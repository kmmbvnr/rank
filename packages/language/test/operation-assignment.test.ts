import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { analyzeBindings, analyzeValues, createRankServices, isFunctionBindingStatement,
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
    it('preserves unopened function bindings and reports unsupported writes', () => {
        expect(isFunctionBindingStatement(parse('env Name = Name').statements[0])).toBe(true);
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
    it('reports attempts to replace a constant declaration while preserving inline replacement', () => {
        expect(analyzeValues(parse('fun fixed X\n return X\nend\nfixed X = X + 1')).diagnostics.some(diagnostic => /function declaration/.test(diagnostic.message))).toBe(true);
        expect(analyzeValues(parse('f X = X\nf X = X + 1')).diagnostics).toEqual([]);
        const inline = analyzeValues(parse('f X = X'));
        expect(analyzeValues(parse('f X = X + 1'), inline.bindings, inline.functions).diagnostics).toEqual([]);
    });
});
