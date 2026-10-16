import { isNameExpression, type Expression } from './generated/ast.js';

/** Consume ordered optional word/value groups; ranking and special forms keep their own clauses. */
export function bindCallWords(
    parts: readonly Expression[], start: number, words: readonly string[], name: string,
    acceptsValue: (value: Expression) => boolean,
    report: (node: Expression, message: string) => void,
): { values: ReadonlyMap<string, Expression>; next: number } {
    const values = new Map<string, Expression>();
    const seen = new Set<string>();
    let next = start, last = -1;
    while (isNameExpression(parts[next])) {
        const marker = parts[next] as Expression & { name: string };
        const index = words.indexOf(marker.name);
        if (index < 0) break;
        if (seen.has(marker.name)) report(marker, `Duplicate ${name} group ${marker.name}`);
        else if (index < last) report(marker, `${name} group ${marker.name} is out of declaration order`);
        seen.add(marker.name);
        last = Math.max(last, index);
        const value = parts[++next];
        if (!value || isNameExpression(value) && (words.includes(value.name)
            || value.name === 'rank' || value.name === 'axis') || !acceptsValue(value)) {
            report(marker, `${name} ${marker.name} expects a value`);
        } else {
            values.set(marker.name, value);
            next++;
        }
    }
    return { values, next };
}
