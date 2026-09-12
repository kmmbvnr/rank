// Input handling for the interactive REPL. Pure functions only: the loop in
// repl.ts owns the terminal, this module owns the rules.
//
// Rank is whitespace-insensitive (WS is a hidden terminal), so the REPL is free
// to re-indent every line it stores and to join a folded line with a space. The
// source it runs stays plain Rank text.

export type TokenKind =
    | 'word' | 'variable' | 'qualified' | 'number' | 'string' | 'symbol' | 'comment';

export interface Token {
    readonly kind: TokenKind;
    readonly text: string;
    readonly start: number;
    readonly end: number;
    /** Strings only: false when the closing quote is missing. */
    readonly closed: boolean;
}

/**
 * Keys that stand in for `=`. Rank has neither token: across the 683 demo
 * programs there is not one comma or colon outside a text literal or a `rem`
 * comment, so either one elsewhere can only ever have meant `=`. The comma is
 * the cheaper of the two, being on the letter layer of a phone keyboard.
 */
export const ASSIGN_KEYS = [',', ':'];

/** Words that stand in for symbols a phone keyboard hides behind a layer. */
export const OPERATOR_ALIASES: Readonly<Record<string, string>> = {
    gets: '=',
    plus: '+',
    minus: '-',
    times: '*',
    over: '/',
    idiv: '//',
    mod: '%',
    power: '**',
    every: '#',
};

/** Aliases that combine with `gets` into a compound assignment. */
const COMPOUND_LEFT = new Set(['plus', 'minus', 'times', 'over', 'idiv', 'mod', 'power']);
const COMPOUND_KEYWORDS = new Set(['and', 'or', 'xor']);
const COMPOUND_SYMBOLS = new Set(['+', '-', '*', '**', '/', '//', '%']);

const SYMBOLS = [
    '**=', '//=', '**', '//', '+=', '-=', '*=', '/=', '%=',
    '=', '+', '-', '*', '/', '%', '(', ')', '#', '.',
];

/** Symbols that cannot end a statement, so the line folds into the next one. */
const OPEN_SYMBOLS = new Set([
    '=', '+=', '-=', '*=', '/=', '//=', '%=', '**=',
    '+', '-', '*', '/', '//', '%', '**', '.', '(',
]);

/** Words that demand a right operand, so the line folds into the next one. */
const OPEN_WORDS = new Set([
    'and', 'or', 'xor', 'not', 'to', 'until', 'by', 'pad', 'equal', 'less',
    'greater', 'in', 'is', 'at', 'least', 'most', 'multiple', 'use', 'as',
    'push', 'yield', 'unpack', 'new', 'stdin', 'catch', 'option', 'argument',
    'flag', 'args', 'on', 'group', 'leftjoin', 'innerjoin',
]);

/** Block keywords, recognized only as the first word of a statement. */
const STATEMENT_BLOCKS = new Set(['test', 'fun', 'memo', 'try', 'if', 'for']);

/** Keywords that cannot end an operand, so what follows them is not binary. */
const NON_OPERAND_WORDS = new Set([
    ...OPEN_WORDS, ...STATEMENT_BLOCKS,
    'else', 'elif', 'finally', 'end', 'record', 'return',
]);

/** Keywords that live inside a block and display one level out. */
const DEDENT_WORDS = new Set(['else', 'elif', 'catch', 'finally']);

/**
 * Word operators, completed whole: `mul` finishes as `multiple by`, so the two
 * halves of a spelled operator never have to be typed or remembered apart.
 */
export const OPERATOR_KEYWORDS = [
    'and', 'or', 'xor', 'not', 'equal', 'not equal', 'less', 'greater',
    'at least', 'at most', 'multiple by', 'in', 'is', 'to', 'until', 'by',
    'pad', 'as', 'axis', 'rank', 'reduce', 'scan', 'outer', 'sort by',
    'argsort by', 'group by', 'leftjoin by', 'innerjoin by', 'leftjoin on',
    'innerjoin on', 'set add', 'counter add', 'filter', 'select', 'ascending', 'descending',
];

export const STATEMENT_KEYWORDS = [
    'args', 'argument', 'array', 'break', 'catch', 'continue', 'elif', 'else',
    'end', 'false', 'finally', 'flag', 'for', 'fun', 'if', 'index', 'memo',
    'new', 'not', 'option', 'push', 'record', 'return', 'run', 'shape', 'stdin',
    'test', 'true', 'try', 'unpack', 'use', 'yield',
];

export function tokenize(line: string): Token[] {
    const tokens: Token[] = [];
    let at = 0;
    while (at < line.length) {
        const character = line[at];
        if (character === ' ' || character === '\t') {
            at += 1;
            continue;
        }
        if (/^rem(?![A-Za-z0-9_])/.test(line.slice(at))) {
            tokens.push(token('comment', line.slice(at), at, line.length, true));
            break;
        }
        if (character === '"') {
            const end = closingQuote(line, at);
            tokens.push(token('string', line.slice(at, end.at), at, end.at, end.closed));
            at = end.at;
            continue;
        }
        const word = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)?/.exec(line.slice(at));
        if (word) {
            const text = word[0];
            const kind = text.includes('.') ? 'qualified'
                : /^[A-Z]/.test(text) ? 'variable' : 'word';
            tokens.push(token(kind, text, at, at + text.length, true));
            at += text.length;
            continue;
        }
        const number = /^[0-9]+(\.[0-9]+)?/.exec(line.slice(at));
        if (number) {
            tokens.push(token('number', number[0], at, at + number[0].length, true));
            at += number[0].length;
            continue;
        }
        const symbol = SYMBOLS.find(candidate => line.startsWith(candidate, at));
        const text = symbol ?? character;
        tokens.push(token('symbol', text, at, at + text.length, true));
        at += text.length;
    }
    return tokens;
}

function token(kind: TokenKind, text: string, start: number, end: number, closed: boolean): Token {
    return { kind, text, start, end, closed };
}

function closingQuote(line: string, start: number): { at: number; closed: boolean } {
    let at = start + 1;
    while (at < line.length) {
        if (line[at] === '\\') {
            at += 2;
            continue;
        }
        if (line[at] === '"') return { at: at + 1, closed: true };
        at += 1;
    }
    return { at: line.length, closed: false };
}

/**
 * Rewrite alias words into the symbols they stand for. A word is only rewritten
 * in operator position, and never when the session already binds that name, so
 * a program that calls its own `times` keeps working.
 */
export function expandOperators(line: string, isBound: (name: string) => boolean): string {
    const tokens = tokenize(line);
    const edits: { start: number; end: number; text: string }[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const current = tokens[index];
        if (current.kind !== 'word') continue;
        const symbol = OPERATOR_ALIASES[current.text];
        if (symbol === undefined || isBound(current.text)) continue;
        if (current.text !== 'every' && !endsOperand(tokens[index - 1])) continue;
        const next = tokens[index + 1];
        const compound = next?.kind === 'word' && next.text === 'gets' && !isBound('gets')
            && COMPOUND_LEFT.has(current.text);
        if (compound) {
            edits.push({ start: current.start, end: next.end, text: `${symbol}=` });
            index += 1;
            continue;
        }
        edits.push({ start: current.start, end: current.end, text: symbol });
    }
    if (edits.length === 0) return line;
    let result = '';
    let at = 0;
    for (const edit of edits) {
        result += line.slice(at, edit.start) + edit.text;
        at = edit.end;
    }
    return result + line.slice(at);
}

function endsOperand(previous: Token | undefined): boolean {
    if (!previous) return false;
    if (previous.kind === 'symbol') return previous.text === ')' || previous.text === '#';
    if (previous.kind === 'comment') return false;
    // A keyword that wants an operand cannot be one, so what follows is a sign
    // rather than an operator: `Q push -1`, `1 to -3`.
    return !(previous.kind === 'word' && NON_OPERAND_WORDS.has(previous.text));
}

// `and gets` reaches expandOperators as the keyword `and` followed by `gets`,
// and the keyword itself is not an alias, so handle that pair separately.
export function expandCompoundKeywords(line: string, isBound: (name: string) => boolean): string {
    if (isBound('gets')) return line;
    const tokens = tokenize(line);
    for (let index = 1; index < tokens.length; index += 1) {
        const current = tokens[index];
        if (current.kind !== 'word' || current.text !== 'gets') continue;
        const previous = tokens[index - 1];
        if (previous.kind === 'word' && COMPOUND_KEYWORDS.has(previous.text)) {
            return line.slice(0, previous.start) + `${previous.text}=` + line.slice(current.end);
        }
    }
    return line;
}

/**
 * Rewrites the `=` key. A colon is not Rank, so outside text and comments it can
 * only have meant `=`, and `+:` or `and:` become `+=` and `and=` for free.
 */
export function expandAssignKey(line: string): string {
    const tokens = tokenize(line);
    let result = '';
    let at = 0;
    for (let index = 0; index < tokens.length; index += 1) {
        const item = tokens[index];
        if (item.kind !== 'symbol' || !ASSIGN_KEYS.includes(item.text)) continue;
        // `*:` and `and:` are the compound assignments, which are single tokens
        // and must not be spaced apart.
        const previous = tokens[index - 1];
        const compound = previous !== undefined
            && ((previous.kind === 'symbol' && COMPOUND_SYMBOLS.has(previous.text))
                || (previous.kind === 'word' && COMPOUND_KEYWORDS.has(previous.text)));
        const start = compound ? previous.start : item.start;
        const before = line.slice(at, start);
        const spaceLeft = !compound && before !== '' && !before.endsWith(' ');
        const spaceRight = item.end < line.length && line[item.end] !== ' ';
        const joinPair = /\b(?:leftjoin|innerjoin)\s+on\b/.test(line.slice(0, item.start));
        result += before + (spaceLeft ? ' ' : '')
            + (joinPair ? 'equal' : (compound ? previous.text : '') + '=')
            + (spaceRight ? ' ' : '');
        at = item.end;
    }
    return at === 0 ? line : result + line.slice(at);
}

/** Operators that read as one space on each side. */
const SPACED_SYMBOLS = new Set([
    '=', '+=', '-=', '*=', '/=', '//=', '%=', '**=',
    '+', '-', '*', '/', '//', '%', '**', '#',
]);

/**
 * Puts one space on each side of every binary operator, so a line typed with no
 * spaces at all is stored the way the language is written. A `+` or `-` that no
 * operand precedes is a sign and stays attached, `.` and brackets are left
 * alone, and text and comments are never touched.
 */
export function spaceOperators(line: string, trailing = false): string {
    const tokens = tokenize(line);
    let result = '';
    let at = 0;
    for (let index = 0; index < tokens.length; index += 1) {
        const item = tokens[index];
        if (item.kind !== 'symbol' || !SPACED_SYMBOLS.has(item.text)) continue;
        const previous = tokens[index - 1];
        if (!endsOperand(previous)) continue;
        // `and=`, `or=` and `xor=` are single tokens spelled as a word plus `=`.
        if (item.text === '=' && previous !== undefined && previous.kind === 'word'
            && previous.end === item.start && COMPOUND_KEYWORDS.has(previous.text)) continue;
        const before = line.slice(at, item.start).replace(/ +$/, '');
        const spaceLeft = before !== '' || at > 0;
        result += before + (spaceLeft ? ' ' : '') + item.text;
        at = item.end;
        const after = /^ */.exec(line.slice(at))![0].length;
        if (at + after < line.length || trailing) result += ' ';
        at += after;
    }
    return at === 0 ? line : result + line.slice(at);
}

/**
 * Collapses runs of spaces outside text and comments. Rank hides whitespace, so
 * this only tidies what the rewrites and the typist leave behind.
 */
export function collapseSpaces(line: string): string {
    const protectedSpans = tokenize(line)
        .filter(item => item.kind === 'string' || item.kind === 'comment');
    let result = '';
    let at = 0;
    for (const span of protectedSpans) {
        result += line.slice(at, span.start).replace(/  +/g, ' ') + span.text;
        at = span.end;
    }
    return result + line.slice(at).replace(/  +/g, ' ');
}

/** The whole rewrite, for a finished line. */
export function formatLine(text: string): string {
    return collapseSpaces(spaceOperators(expandAssignKey(text)));
}

/**
 * The same rewrite for a line still being typed. It keeps the trailing space an
 * operator earns, so the next character starts a new word on its own.
 */
export function formatTyping(prefix: string): string {
    return collapseSpaces(spaceOperators(expandAssignKey(prefix), true));
}

/** True when the position sits inside a text literal or a comment. */
export function insideText(prefix: string): boolean {
    const last = tokenize(prefix).at(-1);
    if (last === undefined || last.end !== prefix.length) return false;
    return last.kind === 'comment' || (last.kind === 'string' && !last.closed);
}

export interface LineScan {
    /** Block keywords opened by this line, outermost first. */
    readonly opens: string[];
    readonly closes: number;
    readonly dedent: boolean;
    readonly parens: number;
    readonly openString: boolean;
    /** The line cannot end a statement, so it folds into the next one. */
    readonly folds: boolean;
}

export function scanLine(line: string): LineScan {
    const tokens = tokenize(line).filter(item => item.kind !== 'comment');
    const opens: string[] = [];
    let closes = 0;
    let parens = 0;
    for (let index = 0; index < tokens.length; index += 1) {
        const current = tokens[index];
        if (current.kind === 'symbol') {
            if (current.text === '(') parens += 1;
            if (current.text === ')') parens = Math.max(0, parens - 1);
            continue;
        }
        if (current.kind !== 'word') continue;
        // `.array` and `.record` are label names, not the constructs.
        if (tokens[index - 1]?.text === '.') continue;
        if (current.text === 'end') {
            closes += 1;
            continue;
        }
        if (current.text === 'record') {
            opens.push('record');
            continue;
        }
        if (index > 0 && index === tokens.length - 1
            && (current.text === 'filter' || current.text === 'select')) {
            opens.push(current.text);
            continue;
        }
        if (current.text === 'array' && tokens[index + 1]?.text === 'shape'
            && !hasPad(tokens, index + 2)) {
            opens.push('array');
            continue;
        }
        if (index === 0 && STATEMENT_BLOCKS.has(current.text)) opens.push(current.text);
    }
    const last = tokens.at(-1);
    const unterminated = tokens.some(item => item.kind === 'string' && !item.closed);
    return {
        opens,
        closes,
        dedent: tokens[0]?.kind === 'word' && DEDENT_WORDS.has(tokens[0].text),
        parens,
        openString: unterminated,
        folds: endsOpen(last),
    };
}

/** A `pad` at paren depth zero closes the shape form, so no `end` is needed. */
function hasPad(tokens: readonly Token[], from: number): boolean {
    let depth = 0;
    for (let index = from; index < tokens.length; index += 1) {
        const text = tokens[index].text;
        if (text === '(') depth += 1;
        else if (text === ')') depth = Math.max(0, depth - 1);
        else if (depth === 0 && tokens[index].kind === 'word' && text === 'pad') return true;
    }
    return false;
}

function endsOpen(last: Token | undefined): boolean {
    if (!last) return false;
    if (last.kind === 'symbol') return OPEN_SYMBOLS.has(last.text);
    if (last.kind !== 'word') return false;
    // `array`, `shape` and `index` are also reference names, so a line may end
    // with them: `1 to 5 array`, `A shape`.
    if (last.text === 'array' || last.text === 'shape' || last.text === 'index') return false;
    return OPEN_WORDS.has(last.text);
}

export interface CellState {
    /** Open block keywords, outermost first. */
    readonly blocks: readonly string[];
    /** A folded statement still waiting for its rest. */
    readonly pending: string;
    /** Completed, re-indented lines of the current cell. */
    readonly lines: readonly string[];
}

export const EMPTY_CELL: CellState = { blocks: [], pending: '', lines: [] };

export function isEmpty(state: CellState): boolean {
    return state.lines.length === 0 && state.pending === '' && state.blocks.length === 0;
}

export function isComplete(state: CellState): boolean {
    return state.pending === '' && state.blocks.length === 0 && state.lines.length > 0;
}

/**
 * Adds one trimmed physical line. A line ends its statement unless it ends with
 * something that cannot: then it folds into the next line. An unclosed quote or
 * bracket is closed here, so each needs only its opening keystroke.
 */
export function addLine(state: CellState, text: string): CellState {
    const joined = state.pending === '' ? text : `${state.pending} ${text}`;
    if (scanLine(joined).folds) return { ...state, pending: joined };
    return store({ ...state, pending: '' }, joined);
}

function store(state: CellState, text: string): CellState {
    const scan = scanLine(text);
    const closed = text + (scan.openString ? '"' : '') + ')'.repeat(scan.parens);
    const kept = state.blocks.slice(0, Math.max(0, state.blocks.length - scan.closes));
    const outdented = scan.closes > 0 || scan.dedent;
    const depth = outdented ? Math.max(0, state.blocks.length - 1) : state.blocks.length;
    return {
        blocks: [...kept, ...scan.opens],
        pending: '',
        lines: [...state.lines, indent(depth) + closed],
    };
}

/** Finishes whatever is open: the folded line, then every `end`. */
export function closeCell(state: CellState): CellState {
    let closed = state.pending === '' ? state : store({ ...state, pending: '' }, state.pending);
    while (closed.blocks.length > 0) closed = addLine(closed, 'end');
    return closed;
}

export function cellSource(state: CellState): string {
    return state.lines.join('\n');
}

/**
 * Indentation the next physical line starts with. A line that begins with a
 * closing keyword sits one level out, which is why `dedent` exists: the prompt
 * can follow the word as it is typed.
 */
export function nextIndent(state: CellState, dedent = false): string {
    const depth = state.blocks.length + (state.pending === '' ? 0 : 1) - (dedent ? 1 : 0);
    return indent(depth);
}

/** True when a line starts with the keyword that closes or splits a block. */
export function startsDedent(text: string): boolean {
    const first = /^[a-z]+/.exec(text.trimStart())?.[0];
    return first !== undefined && (first === 'end' || DEDENT_WORDS.has(first));
}

/** Six characters wide, so continuations line up under the first prompt. */
export function promptFor(state: CellState): string {
    if (state.pending !== '') return '....> ';
    const open = state.blocks.at(-1);
    if (open === undefined) return 'rank> ';
    return `${(open + '....').slice(0, 4)}> `;
}

function indent(depth: number): string {
    return '  '.repeat(Math.max(0, depth));
}

/** A stored line wider than this is wrapped; the wrap aims for WRAP_WIDTH. */
export const WRAP_LIMIT = 50;
export const WRAP_WIDTH = 40;

/**
 * Operators a wrap may break before. Rank only allows a line break inside
 * brackets, and only around these, so the set is exactly the multiline grammar:
 * assignment, application and unary operators are not in it.
 */
const BREAK_SYMBOLS = new Set(['+', '-', '*', '/', '//', '%', '**']);
const BREAK_WORDS = new Set([
    'or', 'xor', 'and', 'equal', 'less', 'greater', 'in', 'is', 'pad',
    'to', 'until', 'at', 'multiple',
]);

/** Keywords whose statement is one expression the wrap can bracket. */
const EXPRESSION_KEYWORDS = new Set(['if', 'elif', 'return', 'yield', 'for']);
const ASSIGNMENT_SYMBOLS = new Set([
    '=', '+=', '-=', '*=', '/=', '//=', '%=', '**=',
]);
/** Clauses that spell a label pair with `=`, which is not an assignment. */
const JOIN_WORDS = new Set(['group', 'leftjoin', 'innerjoin']);

/**
 * Breaks one long line into a bracketed group of narrow ones. Rank continues an
 * expression across lines only inside brackets, so the wrap adds the brackets
 * and breaks before operators the multiline grammar allows. A line it cannot
 * break — an application chain, say — is returned unchanged.
 */
export function wrapLine(
    line: string, indent = '', width = WRAP_WIDTH, limit = WRAP_LIMIT,
): string[] {
    const full = indent + line;
    if (full.length <= limit) return [full];
    // A join key pair is not a general comparison expression; its optional
    // line break belongs after `on`, not before `equal`.
    if (/\b(?:leftjoin|innerjoin)\s+on\b/.test(line)) return [full];
    const tokens = tokenize(line);
    const start = expressionStart(tokens);
    if (start === undefined || start >= tokens.length) return [full];

    const body = tokens.slice(start);
    const bracketed = isBracketed(body);
    const inner = bracketed ? body.slice(1, -1) : body;
    const chunks = breakChunks(line, inner);
    if (chunks.length < 2) return [full];

    const head = line.slice(0, (bracketed ? body[0] : inner[0]).start).trimEnd();
    const nested = indent + '  ';
    const lines = [head === '' ? `${indent}(` : `${indent}${head} (`];
    let current = '';
    for (const chunk of chunks) {
        const candidate = current === '' ? chunk : `${current} ${chunk}`;
        if (current !== '' && (nested + candidate).length > width) {
            lines.push(nested + current);
            current = chunk;
        } else {
            current = candidate;
        }
    }
    if (current !== '') lines.push(nested + current);
    lines.push(`${indent})`);
    return lines;
}

/** Wraps every long line of a cell, keeping the indentation each one has. */
export function wrapSource(source: string, width = WRAP_WIDTH, limit = WRAP_LIMIT): string {
    return source.split('\n').flatMap(line => {
        const indent = /^ */.exec(line)![0];
        return wrapLine(line.slice(indent.length), indent, width, limit);
    }).join('\n');
}

/** Index of the first token of the expression this statement can bracket. */
function expressionStart(tokens: readonly Token[]): number | undefined {
    let depth = 0;
    for (let index = 0; index < tokens.length; index += 1) {
        const item = tokens[index];
        if (item.kind === 'symbol') {
            if (item.text === '(') depth += 1;
            else if (item.text === ')') depth -= 1;
            else if (depth === 0 && ASSIGNMENT_SYMBOLS.has(item.text)) return index + 1;
            continue;
        }
        if (depth !== 0 || item.kind !== 'word') continue;
        // A join condition is an expression, even when the statement begins with assignment.
        if (JOIN_WORDS.has(item.text)) return undefined;
        if (item.text === 'push') return index + 1;
        if (index === 0 && EXPRESSION_KEYWORDS.has(item.text)) return 1;
    }
    return tokens.length === 0 ? undefined : 0;
}

function isBracketed(body: readonly Token[]): boolean {
    if (body.length < 3 || body[0].text !== '(' || body.at(-1)!.text !== ')') return false;
    let depth = 0;
    for (let index = 0; index < body.length - 1; index += 1) {
        if (body[index].text === '(') depth += 1;
        else if (body[index].text === ')') depth -= 1;
        if (depth === 0) return false;
    }
    return true;
}

/** Source chunks of the expression, cut before every operator it may break at. */
function breakChunks(line: string, inner: readonly Token[]): string[] {
    if (inner.length === 0) return [];
    const starts = [0];
    let depth = 0;
    for (let index = 1; index < inner.length; index += 1) {
        const item = inner[index];
        if (item.kind === 'symbol') {
            if (item.text === '(') depth += 1;
            else if (item.text === ')') depth -= 1;
        }
        if (depth !== 0 || !breaksBefore(inner, index)) continue;
        starts.push(index);
    }
    return starts.map((from, position) => {
        const to = position + 1 < starts.length ? starts[position + 1] - 1 : inner.length - 1;
        return line.slice(inner[from].start, inner[to].end);
    });
}

function breaksBefore(inner: readonly Token[], index: number): boolean {
    const item = inner[index];
    const previous = inner[index - 1];
    if (item.kind === 'symbol') {
        return BREAK_SYMBOLS.has(item.text) && endsOperand(previous);
    }
    if (item.kind !== 'word' || !BREAK_WORDS.has(item.text)) return false;
    // `not equal` is one operator, and `sort by` is one token.
    return !(previous.kind === 'word' && previous.text === 'not');
}

/**
 * The line each statement of a file begins at.
 *
 * A statement is what the REPL can put back at a prompt: stepping into the
 * middle of a block would offer a body line with nothing holding it, so
 * walking a file backwards moves between these and lets the cell machinery
 * carry the lines between them.
 */
export function cellStarts(lines: readonly string[]): number[] {
    const starts: number[] = [];
    let state = EMPTY_CELL;
    for (const [index, line] of lines.entries()) {
        if (isEmpty(state)) starts.push(index);
        const text = line.trim();
        if (text !== '') state = addLine(state, text);
        if (isComplete(state)) state = EMPTY_CELL;
    }
    return starts;
}
