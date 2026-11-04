import { isNameExpression, isParenthesizedExpression, isTupleExpression, type NameExpression, type UnpackStatement } from '@arrrank/language';

/** Parallel moves preserve one owner per binding. A duplicate, omitted target,
 * computed operand or ordinary assignment needs a separate snapshot proof. */
export function arrayPermutation(statement: UnpackStatement): [string, NameExpression][] | undefined {
    let value = statement.value;
    while (isParenthesizedExpression(value)) value = value.value;
    if (!isTupleExpression(value) || value.items.length !== statement.names.length) return undefined;
    const targets = new Set(statement.names);
    if (targets.size !== statement.names.length || [...targets].some(name => name === '#' || name.includes('.'))) return undefined;
    const pairs: [string, NameExpression][] = [];
    for (const [index, item] of value.items.entries()) {
        let source = item.value;
        while (source && isParenthesizedExpression(source)) source = source.value;
        if (item.sign || !isNameExpression(source) || !targets.delete(source.name)) return undefined;
        pairs.push([statement.names[index], source]);
    }
    return pairs;
}
