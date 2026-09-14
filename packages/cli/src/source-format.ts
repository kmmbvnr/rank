import { parse } from '@arrrank/interpreter';
import stringWidth from 'string-width';
import { tokenize, type Token } from './repl-input.js';

const precedence: Readonly<Record<string, number>> = {
    or: 1, xor: 2, and: 3,
    equal: 4, not: 4, less: 4, greater: 4, at: 4, multiple: 4, in: 4, is: 4,
    pad: 5, to: 6, until: 6, by: 6,
    '+': 7, '-': 7, '*': 8, '/': 8, '//': 8, '%': 8, '**': 9,
};
const assignment = new Set(['=', '+=', '-=', '*=', '**=', '/=', '//=', '%=']);
const expressionStatements = new Set(['return', 'yield', 'if', 'elif', 'for']);

function operand(token: Token | undefined): boolean {
    return token !== undefined && (token.kind === 'number' || token.kind === 'string'
        || token.kind === 'variable' || token.kind === 'qualified'
        || token.kind === 'word' && precedence[token.text] === undefined
        || token.text === ')' || token.text === '#');
}

/** Add only an outer expression group; never split an application or a string. */
function wrapLine(line: string, width: number): string {
    if (stringWidth(line) <= width) return line;
    const tokens = tokenize(line);
    const comment = tokens.findIndex(token => token.kind === 'comment');
    const code = comment < 0 ? tokens : tokens.slice(0, comment);
    if (!code.length) return line;
    let start = expressionStatements.has(code[0].text) ? 1 : 0;
    let depth = 0;
    for (let i = 0; i < code.length; i++) {
        const token = code[i];
        if (token.text === '(') depth++;
        else if (token.text === ')') depth--;
        else if (depth === 0 && (assignment.has(token.text) || token.text === 'push')) {
            start = i + 1;
            break;
        }
    }
    if (start >= code.length) return line;
    const indent = /^ */.exec(line)![0];
    let body = code.slice(start);
    // Reuse an existing outer group, without stripping inner operand groups.
    let bracketed = body[0].text === '(' && body.at(-1)!.text === ')';
    depth = 0;
    for (let i = 0; bracketed && i < body.length - 1; i++) {
        if (body[i].text === '(') depth++;
        if (body[i].text === ')') depth--;
        if (depth === 0) bracketed = false;
    }
    const head = line.slice(0, body[0].start).trimEnd();
    if (bracketed) body = body.slice(1, -1);
    if (!body.length) return line;
    const breaks: { offset: number; precedence: number }[] = [];
    depth = 0;
    for (let i = 0; i < body.length; i++) {
        const token = body[i];
        if (token.text === '(') depth++;
        else if (token.text === ')') depth--;
        if (depth !== 0 || !operand(body[i - 1])) continue;
        const level = precedence[token.text];
        if (level === undefined) continue;
        if (token.text === 'not' && !['equal', 'in'].includes(body[i + 1]?.text)) continue;
        if (body[i - 1]?.text === 'not') continue;
        breaks.push({ offset: token.start, precedence: level });
    }
    const first = (head || indent) + (head ? ' (' : '(');
    const last = indent + ')' + (comment < 0 ? '' : ' ' + tokens[comment].text);
    const nested = indent + '  ';
    // Prefer whole logical clauses, then allow finer arithmetic breaks if necessary.
    for (const level of [...new Set(breaks.map(item => item.precedence))].sort((a, b) => a - b)) {
        const offsets = [body[0].start, ...breaks.filter(item => item.precedence <= level).map(item => item.offset)];
        const chunks = offsets.map((from, i) => line.slice(from, offsets[i + 1] ?? body.at(-1)!.end).trim());
        const lines = [first];
        let current = nested;
        for (const chunk of chunks) {
            const candidate = current === nested ? nested + chunk : current + ' ' + chunk;
            if (current !== nested && stringWidth(candidate) > width) {
                lines.push(current);
                current = nested + chunk;
            } else current = candidate;
        }
        lines.push(current, last);
        if (lines.every(item => stringWidth(item) <= width)) return lines.join('\n');
    }
    return line;
}

/** Check the parsed program, including the REPL's current binding signatures. */
export function formatSource(
    source: string, width = 40, bindings?: ReadonlyMap<string, readonly number[] | false>,
): string {
    if (!source.split('\n').some(line => stringWidth(line) > width)) return source;
    try {
        const program = parse(source, '<format>', { bindings });
        const protectedLines = new Set<number>();
        const shape = (key: string, value: any): unknown => {
            if (key.startsWith('$') && key !== '$type') return undefined;
            if (value?.$type === 'StringLiteral' && value.$cstNode) {
                const { start, end } = value.$cstNode.range;
                if (start.line !== end.line) {
                    for (let line = start.line; line <= end.line; line++) protectedLines.add(line);
                }
            }
            while (value?.$type === 'ParenthesizedExpression') value = value.value;
            return typeof value === 'bigint' ? `${value}n` : value;
        };
        const original = JSON.stringify(program, shape);
        const formatted = source.split('\n').map((line, index) =>
            protectedLines.has(index) ? line : wrapLine(line, width)).join('\n');
        if (formatted === source) return source;
        return JSON.stringify(parse(formatted, '<format>', { bindings }), shape) === original ? formatted : source;
    } catch {
        // An incomplete/erroring source or an unsafe break remains editable as written.
        return source;
    }
}
