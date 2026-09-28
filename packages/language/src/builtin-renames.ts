import { isNameExpression, type Expression, type NameExpression } from './generated/ast.js';

/** Removed builtin spellings supply diagnostics, never compatibility aliases. */
const builtinRenames = [
    { receiver: 'dsu', from: 'find', to: 'findroot', arity: 2, display: 'DSU' },
] as const;

export function renamedBuiltinCall(parts: readonly Expression[]): {
    operation: NameExpression;
    receiver: string;
    message: string;
} | undefined {
    for (const rename of builtinRenames) {
        if (parts.length !== rename.arity + 1) continue;
        // Accept the former receiver-method and data-first spellings.
        const operation = [parts[1], parts.at(-1)].find(part =>
            part && isNameExpression(part) && part.name === rename.from);
        if (operation && isNameExpression(operation)) return {
            operation, receiver: rename.receiver,
            message: `${rename.display} ${rename.from} is now ${rename.to}`,
        };
    }
    return undefined;
}
