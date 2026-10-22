import { readFileSync } from 'node:fs';
import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { analyzeFunctionScopes, createRankServices, expressionDiagnostics, functionScopeDiagnostics, type Program } from '../src/index.js';

const source = readFileSync(new URL('./fixtures/305_local_automaton.ra', import.meta.url), 'utf8');
const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function parse(text: string) {
    const parsed = parser.parse<Program>(text);
    expect(parsed.lexerErrors).toEqual([]);
    expect(parsed.parserErrors).toEqual([]);
    expect(expressionDiagnostics(parsed.value)).toEqual([]);
    return parsed.value;
}

describe('Euler 305 local automaton', () => {
    it('accepts recursive local helpers with captures owned by solve', () => {
        const program = parse(source);
        expect(functionScopeDiagnostics(program)).toEqual([]);
        const analysis = analyzeFunctionScopes(program);
        const [solve] = [...analysis.functions.keys()].filter(fn => fn.name === 'solve');
        const [nth, info] = [...analysis.functions].find(([fn]) => fn.name === 'nth')!;
        expect(info.scope.parent?.owner).toBe(solve);
        expect([...info.captures].map(binding => binding.name).sort()).toEqual(['PatternHits', 'PatternLength', 'PatternNext']);
        expect([...info.captures].every(binding => binding.scope.owner === solve)).toBe(true);
        expect(analysis.functions.get(solve)?.callees.has(nth)).toBe(true);
    });

    it('reports a structural error if the recursive group mutates captured engine state', () => {
        const program = parse(source.replace(/\bState (?=[A-Z(])/g, ''));
        const messages = functionScopeDiagnostics(program).map(item => item.message);
        expect(messages).toContain('State is read-only in id; pass mutable state explicitly as a parameter.');
        expect(messages.some(message => message.includes('analysis limit'))).toBe(false);
    });

    it('rejects returning a helper from the group', () => {
        const program = parse(source.replace('  return State Need nth', '  return id'));
        expect(functionScopeDiagnostics(program).map(item => item.message)).toContain(
            'nested function id cannot be returned, assigned, or stored; call it or pass it directly to a helper.');
    });

    it('permits a filtered result whose callback captures are snapshotted', () => {
        const program = parse(source.replace('  return State Need nth', '  fun X below = X less Need\n  return 1 to 10 filter below'));
        expect(functionScopeDiagnostics(program)).toEqual([]);
    });
});
