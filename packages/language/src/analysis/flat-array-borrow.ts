import {
    isApplicationExpression, isNameExpression, isNumberLiteral, isParenthesizedExpression,
    isReturnStatement, type Expression, type FunctionStatement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';

/** Possible flat-array borrows. The caller must check argument kind and callable identity. */
export function flatArrayBorrowCandidates(definition: FunctionStatement,
    resolve: (name: string) => FunctionStatement | undefined): ReadonlySet<number> {
    const cache = new WeakMap<FunctionStatement, ReadonlySet<number>>();
    const active = new WeakSet<FunctionStatement>();
    let budget = 100;
    const directName = (value: Expression | undefined, parameter: string): boolean => {
        while (value && isParenthesizedExpression(value)) value = value.value;
        return !!value && isNameExpression(value) && value.name === parameter;
    };
    const inspect = (current: FunctionStatement): ReadonlySet<number> => {
        const cached = cache.get(current);
        if (cached) return cached;
        if (active.has(current) || budget-- <= 0) return new Set();
        active.add(current);
        try {
            const onlyReads = (node: unknown, parameter: string): boolean => {
                if (!node || typeof node !== 'object') return true;
                if (Array.isArray(node)) return node.every(child => onlyReads(child, parameter));
                const item = node as Record<string, unknown>;
                if (isNameExpression(item)) return item.name === parameter;
                if (isReturnStatement(item) && directName(item.value, parameter)) return false;
                if (isApplicationExpression(item)) {
                    // Only direct numeric indexing is known to read a flat array.
                    if (directName(item.head, parameter) && item.arguments.every(isNumberLiteral)) return true;
                    const parts = flattenApplication(item);
                    const target = parts.at(-1)!;
                    if (!isNameExpression(target) || current.parameters.includes(target.name)
                        || parts.length !== 2 || !directName(parts[0], parameter)) return false;
                    const helper = resolve(target.name);
                    return !!helper && helper.parameters.length === 1 && inspect(helper).has(0);
                }
                switch (item.$type) {
                    case 'ReturnStatement':
                    case 'IfStatement':
                    case 'ElifClause':
                    case 'BinaryExpression':
                    case 'UnaryExpression':
                    case 'ParenthesizedExpression':
                    case 'NumberLiteral':
                    case 'BooleanLiteral':
                    case 'StringLiteral':
                    case 'LabelLiteral':
                        return Object.entries(item).every(([key, child]) =>
                            key.startsWith('$') || onlyReads(child, parameter));
                    default:
                        return false;
                }
            };
            const result = new Set(current.parameters.flatMap((parameter, index) =>
                onlyReads(current.statements, parameter) ? [index] : []));
            cache.set(current, result);
            return result;
        } finally { active.delete(current); }
    };
    return inspect(definition);
}
