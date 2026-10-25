import { forAxes, flattenApplication, isCountClauseExpression, isNameExpression, isParenthesizedExpression, type Expression } from '@arrrank/language';
import type { IterationBinding } from './integer-loop-plan.js';

/** Normalize traversal syntax independently of backend code generation. */
export interface LoopTraversal {
    source: Expression;
    indexed: boolean;
    reverse?: boolean;
    slice?: { count: Expression; drop: boolean };
}
export function loopTraversal(binding: IterationBinding): LoopTraversal | undefined {
    if (forAxes(binding.iterable)) return undefined;
    const names = binding.names;
    if (names.length > 2 || names.some(name => name.includes('.'))
        || new Set(names.filter(name => name !== '#')).size !== names.filter(name => name !== '#').length) return undefined;
    let source = binding.iterable;
    while (isParenthesizedExpression(source)) source = source.value;
    const indexed = names.length === 2 && names[1] !== '#';
    const parts = flattenApplication(source);
    if (parts.length === 2 && isNameExpression(parts[1]) && parts[1].name === 'reverse') {
        let input = parts[0];
        while (isParenthesizedExpression(input)) input = input.value;
        if (isNameExpression(input)) return { source: input, indexed, reverse: true };
    }
    if (isCountClauseExpression(source)) {
        const slice = { count: source.count, drop: source.operator === 'drop' };
        source = source.source;
        while (isParenthesizedExpression(source)) source = source.value;
        // Initially only trusted named vectors; arbitrary sequence expressions
        // retain their ordinary iterator and evaluation semantics.
        if (!isNameExpression(source)) return undefined;
        return { source, indexed, slice };
    }
    return { source, indexed };
}
