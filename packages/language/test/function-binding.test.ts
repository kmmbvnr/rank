import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import {
    analyzeBindings, blockScopeDiagnostics, createRankServices, expressionDiagnostics,
    functionBindingPlan, isFunctionBindingStatement, type Program,
} from '../src/index.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function parse(source: string): Program {
    const result = parser.parse<Program>(source);
    expect(result.lexerErrors).toEqual([]);
    expect(result.parserErrors).toEqual([]);
    return result.value;
}
describe('function binding analysis', () => {
    it('groups complete entry stages and records all supported arities', () => {
        const program = parse('use numbers\nproducts = reduce * rank 1 max\npositive_max = max abs');
        const plans = program.statements.filter(isFunctionBindingStatement).map(functionBindingPlan);
        expect(expressionDiagnostics(program)).toEqual([]);
        expect(plans.map(plan => plan.arities)).toEqual([[1], [1, 2]]);
        const facts = analyzeBindings(program);
        expect(facts.scopes[0].bindings.find(binding => binding.name === 'positive_max')?.arities).toEqual([1, 2]);
    });
    it('separates parameter scope from sequential name availability', () => {
        const program = parse('1 f\nf X = X + 1');
        expect(blockScopeDiagnostics(program)[0]?.message).toMatch(/before it is assigned/);
        const valid = parse('f X = X + 1\n1 f');
        expect(blockScopeDiagnostics(valid)).toEqual([]);
        expect(expressionDiagnostics(valid)).toEqual([]);
    });
    it('rejects a later binary-only stage before execution', () => {
        const program = parse('use numbers\nuse linalg\nf = abs matmul');
        expect(expressionDiagnostics(program)[0]?.message).toMatch(/must accept one value/);
    });
});
