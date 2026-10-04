import { tokenize } from './repl-input.js';

/** A bracket pair as the run of other tokens it encloses: `[from, to)` counts tokens that are not brackets. */
type Span = readonly [number, number];

interface Pair {
    readonly open: number;
    readonly close: number;
    readonly span: Span;
}

function pairsOf(line: string): Pair[] | undefined {
    const stack: { offset: number; seen: number }[] = [];
    const pairs: Pair[] = [];
    let seen = 0;
    for (const item of tokenize(line)) {
        if (item.kind === 'symbol' && item.text === '(') stack.push({ offset: item.start, seen });
        else if (item.kind === 'symbol' && item.text === ')') {
            const open = stack.pop();
            if (!open) return undefined;
            pairs.push({ open: open.offset, close: item.start, span: [open.seen, seen] });
        } else seen++;
    }
    return stack.length === 0 ? pairs : undefined;
}

const OPERATORS = new Set(['+', '-', '*', '**', '/', '//', 'mod']);

/** Whether the group would take in an assignment, or start or end on an operator missing an operand; a leading `-` is a sign. */
function dangling(line: string, span: Span): boolean {
    const inside = tokenize(line).filter(item => !(item.kind === 'symbol' && (item.text === '(' || item.text === ')')))
        .slice(span[0], span[1]);
    const operator = (item: { kind: string; text: string }) => item.kind === 'symbol' && OPERATORS.has(item.text);
    if (inside.some(item => item.kind === 'symbol' && item.text.endsWith('='))) return true;
    return operator(inside.at(-1)!) || operator(inside[0]) && inside[0].text !== '-';
}

const key = (span: Span) => `${span[0]}:${span[1]}`;

/** The bracket at `offset` and its partner, when the line is balanced and `offset` is a bracket. */
function pairAt(line: string, offset: number): Pair | undefined {
    return pairsOf(line)?.find(pair => pair.open === offset || pair.close === offset);
}

/** The offset of the bracket that pairs with the one at `offset`. */
export function parenPartner(line: string, offset: number): number | undefined {
    const pair = pairAt(line, offset);
    return pair && (offset === pair.open ? pair.close : pair.open);
}

/**
 * Where the bracket at `offset` can be dropped, as offsets into `line`. A `(` lands on the start of a
 * token and a `)` on the end of one; every other pair keeps enclosing the same tokens, and the
 * group keeps at least one. Dropping a bracket where it started is not a move, so it is left out.
 */
export function parenSnaps(line: string, offset: number): number[] {
    const pair = pairAt(line, offset);
    if (!pair) return [];
    const opening = offset === pair.open;
    const snaps: number[] = [];
    for (const item of tokenize(line)) {
        if (item.kind === 'symbol' && (item.text === '(' || item.text === ')')) continue;
        const target = opening ? item.start : item.end;
        if (target === offset || target === offset + 1) continue;
        if (moveParen(line, offset, target)) snaps.push(target);
    }
    return snaps;
}

/**
 * `line` with the bracket at `offset` moved to `target`, or `undefined` when that would cross another
 * pair, empty the group, or turn the line into something other than one bracket moved.
 */
export function moveParen(line: string, offset: number, target: number): { line: string; offset: number } | undefined {
    const pair = pairAt(line, offset);
    if (!pair || target < 0 || target > line.length || target === offset) return undefined;
    const rest = line.slice(0, offset) + line.slice(offset + 1);
    const at = target > offset ? target - 1 : target;
    const moved = rest.slice(0, at) + line[offset] + rest.slice(at);
    const pairs = pairsOf(moved);
    const next = pairs?.find(item => item.open === at || item.close === at);
    if (!pairs || !next || next.span[1] <= next.span[0] || dangling(moved, next.span)) return undefined;
    const others = new Map<string, number>();
    for (const item of pairsOf(line)!) {
        if (item !== pair) others.set(key(item.span), (others.get(key(item.span)) ?? 0) + 1);
    }
    for (const item of pairs) {
        if (item === next) continue;
        const count = others.get(key(item.span));
        if (!count) return undefined;
        others.set(key(item.span), count - 1);
    }
    return { line: moved, offset: at };
}
