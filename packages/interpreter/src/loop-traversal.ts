import { isParenthesizedExpression, type Expression } from '@arrrank/language';
import type { IterationBinding } from './integer-loop-plan.js';

/** Normalize traversal syntax independently of backend code generation. */
export function loopTraversal(binding: IterationBinding): { source: Expression; indexed: boolean } | undefined {
    const names = binding.names;
    if (names.length > 2 || names.some(name => name.includes('.'))
        || new Set(names.filter(name => name !== '#')).size !== names.filter(name => name !== '#').length) return undefined;
    let source = binding.iterable;
    while (isParenthesizedExpression(source)) source = source.value;
    return { source, indexed: names.length === 2 && names[1] !== '#' };
}
