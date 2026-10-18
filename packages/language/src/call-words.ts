import { isNameExpression, type Expression } from './generated/ast.js';

/** Consume ordered optional word/value groups; ranking and special forms keep their own clauses. */
export function bindCallWords(
    parts: readonly Expression[], start: number, words: readonly string[], name: string,
    acceptsValue: (value: Expression) => boolean,
    report: (node: Expression, message: string) => void,
    nameOf: (node: Expression) => string = node => isNameExpression(node) ? node.name : '',
): { values: ReadonlyMap<string, Expression>; next: number } {
    const values = new Map<string, Expression>();
    const seen = new Set<string>();
    let next = start, last = -1;
    while (isNameExpression(parts[next])) {
        const marker = parts[next] as Expression & { name: string };
        const word = nameOf(marker);
        const index = words.indexOf(word);
        if (index < 0) break;
        if (seen.has(word)) report(marker, `Duplicate ${name} group ${word}`);
        else if (index < last) report(marker, `${name} group ${word} is out of declaration order`);
        seen.add(word);
        last = Math.max(last, index);
        const value = parts[++next];
        if (!value || isNameExpression(value) && (words.includes(nameOf(value))
            || nameOf(value) === 'rank' || nameOf(value) === 'axis') || !acceptsValue(value)) {
            report(marker, `${name} ${word} expects a value`);
        } else {
            values.set(word, value);
            next++;
        }
    }
    return { values, next };
}
