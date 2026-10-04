import { acceptsNext, moduleOperations, modules as builtinModules, nextTokens, type Module } from '@arrrank/language';
import { OPERATOR_KEYWORDS, STATEMENT_KEYWORDS, endsOperand, insideText, tokenize, type Token } from './repl-input.js';

export interface KeyboardTab {
    readonly module: string;
    readonly keys: readonly string[];
}

/** Keywords that only open a statement, so they belong at the start of a line. */
const STATEMENT_HEADS = new Set([
    'args', 'argument', 'break', 'catch', 'continue', 'elif', 'else', 'end', 'finally',
    'flag', 'for', 'fun', 'if', 'memo', 'option', 'return', 'run', 'test', 'try', 'use', 'yield',
]);

/** Statement keywords that continue an open block; the grammar knows which block is open. */
const CONTINUATIONS = new Set(['catch', 'elif', 'else', 'end', 'finally']);

/** Words that open an operand, so they never follow one. */
const PREFIX = new Set(['array', 'new', 'not', 'record', 'stdin']);

/** Higher-order operations follow their operands and take the operator after them: `A reduce +`, `A B outer equal`. */
const REDUCED = new Set(['+', '-', '*', '**', '/', '//', 'mod', 'and', 'or', 'xor']);
const COMPARED = new Set(['equal', 'less', 'greater', 'least', 'most', 'by']);
/** `rank` and `axis` follow a function name: `len axis`, `integer rank`; `scan` follows the values it applies to. */
const function_ = (previous: Token) => previous.kind === 'word' && endsOperand(previous);
const MODIFIERS: Readonly<Record<string, (previous: Token) => boolean>> = {
    reduce: previous => endsOperand(previous),
    scan: previous => endsOperand(previous),
    outer: previous => endsOperand(previous),
    rank: previous => REDUCED.has(previous.text) || COMPARED.has(previous.text) || function_(previous),
    axis: previous => REDUCED.has(previous.text) || COMPARED.has(previous.text) || function_(previous),
};

/**
 * Postfix forms that take exactly one operand: `Values sort by .x`, but `(A B) sort by .x`.
 * Pipeline clauses such as `filter` and `till` continue any operand, so they are infix.
 */
const SINGLE = new Set(['sort by', 'argsort by', 'group by', 'first where', 'first index where', 'select']);

/** Joins take two operands side by side: `Days Revenue leftjoin by .date`. */
const PAIR = new Set(['leftjoin by', 'innerjoin by', 'leftjoin on', 'innerjoin on']);

/** Words that only extend one construct earlier on the line. */
const EXTENDS: Readonly<Record<string, (words: readonly string[]) => boolean>> = {
    by: words => words.includes('to') || words.includes('till'),
    fill: words => words.includes('shape'),
    as: words => words[0] === 'use',
};

/** Items of an `array` literal run to the end of its bracket, and operators cannot stand between them. */
function insideArray(tokens: readonly Token[]): boolean {
    const levels = [false];
    for (const token of tokens) {
        if (token.text === '(') levels.push(false);
        else if (token.text === ')') { if (levels.length > 1) levels.pop(); }
        else if (token.kind === 'word' && token.text === 'array') levels[levels.length - 1] = true;
    }
    return levels.at(-1)!;
}

/** Word operators that take a left operand. */
const INFIX = new Set(OPERATOR_KEYWORDS.filter(word => !PREFIX.has(word) && !(word in MODIFIERS)
    && !SINGLE.has(word) && !PAIR.has(word) && !(word in EXTENDS)));

/** How many operands stand side by side at the end of the line, a bracketed group counting once. */
function trailingOperands(tokens: readonly Token[]): number {
    let count = 0;
    for (let at = tokens.length - 1; at >= 0; at--) {
        const token = tokens[at];
        if (token.kind === 'symbol' && token.text === ')') {
            let depth = 0;
            for (; at >= 0; at--) {
                if (tokens[at].text === ')') depth++;
                else if (tokens[at].text === '(' && --depth === 0) break;
            }
        } else if (!endsOperand(token) || PREFIX.has(token.text)) break;
        count++;
    }
    return count;
}

/**
 * One tab per module in use, `core` first: it carries the keywords, which need
 * no `use`. The phone keyboard already has the symbols, so there are none here.
 * A module that is not imported, or exports no names, has no tab.
 */
export function keyboardTabs(modules: Iterable<string>): KeyboardTab[] {
    const used = new Set(modules);
    used.delete('core');
    const words = (module: string) => [...new Set(moduleOperations(module).map(operation => operation.name))];
    const core = [...STATEMENT_KEYWORDS, ...OPERATOR_KEYWORDS, ...words('core')];
    return [
        { module: 'core', keys: [...new Set(core)] },
        ...[...used].sort().map(module => ({ module, keys: words(module) }))
            .filter(tab => tab.keys.length > 0),
    ];
}

/** Built-in modules available to import, with the catalogue's descriptions. */
export function keyboardModules(imported: Iterable<string>): readonly Module[] {
    const used = new Set(['core', ...imported]);
    return builtinModules.filter(module => !used.has(module.name));
}

/**
 * Whether a key can be typed after `before`, the cell source up to the cursor.
 * The grammar decides what may follow; statement keywords open a line, word
 * operators follow an operand, and nothing goes into text, a comment or the
 * module name after `use`.
 */
export function keyAvailable(key: string, before: string): boolean {
    const line = before.slice(before.lastIndexOf('\n') + 1);
    if (insideText(line)) return false;
    const tokens = tokenize(line);
    const last = tokens.at(-1);
    if (last?.kind === 'word' && (last.text === 'use' || last.text === 'ops')) return false;
    if (line.trim() === '') {
        if (CONTINUATIONS.has(key)) return nextTokens(before).has(key);
        if (STATEMENT_HEADS.has(key)) return true;
        // The completion parser sees only a line break here, so ask what starts an expression.
        return !OPERATOR_KEYWORDS.includes(key) && acceptsNext('X = ', key)
            || PREFIX.has(key);
    }
    if (STATEMENT_HEADS.has(key)) return false;
    if (key in MODIFIERS) return MODIFIERS[key](last!);
    const words = tokens.map(token => token.text);
    if (key in EXTENDS) return EXTENDS[key](words) && endsOperand(last) && !(last!.text in EXTENDS)
        && !['shape', 'to', 'till', 'use'].includes(last!.text);
    if (insideArray(tokens) && OPERATOR_KEYWORDS.includes(key)) return false;
    if (SINGLE.has(key)) return trailingOperands(tokens) === 1;
    if (PAIR.has(key)) return trailingOperands(tokens) >= 2;
    // An operand ends here unless the last word still waits for one: `array 3` does, `array` does not.
    const operand = endsOperand(last) && !PREFIX.has(last!.text);
    if (INFIX.has(key) && !operand || PREFIX.has(key) && operand) return false;
    return acceptsNext(before, key);
}

/**
 * The text a key inserts before the cursor: it is separated from what precedes
 * it and followed by a space, so tapping keys in a row builds a readable line
 * without reaching for the space bar.
 */
export function keyText(key: string, before: string): string {
    const separated = before === '' || /[\s(]$/.test(before);
    return (separated ? '' : ' ') + key + ' ';
}
