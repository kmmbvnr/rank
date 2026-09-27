import { moduleOperations } from '@arrrank/language';
import { OPERATOR_KEYWORDS, STATEMENT_KEYWORDS, endsOperand, insideText, tokenize } from './repl-input.js';

export interface KeyboardTab {
    readonly module: string;
    readonly keys: readonly string[];
}

/** Keywords that only open a statement, so they belong at the start of a line. */
const STATEMENT_HEADS = new Set([
    'args', 'argument', 'break', 'catch', 'continue', 'elif', 'else', 'end', 'finally',
    'flag', 'for', 'fun', 'if', 'memo', 'option', 'return', 'run', 'test', 'try', 'use', 'yield',
]);

/** Word operators that take a left operand; `not` is a prefix and stands anywhere. */
const INFIX = new Set(OPERATOR_KEYWORDS.filter(word => word !== 'not'));

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

/**
 * Whether a key can be typed after `before`, the source up to the cursor:
 * statement keywords open a line, word operators follow an operand, and
 * nothing is typed into text or a comment.
 */
export function keyAvailable(key: string, before: string): boolean {
    const line = before.slice(before.lastIndexOf('\n') + 1);
    if (insideText(line)) return false;
    if (STATEMENT_HEADS.has(key)) return line.trim() === '';
    if (INFIX.has(key)) return endsOperand(tokenize(line).at(-1));
    return true;
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
