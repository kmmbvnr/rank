import type { NotebookCell } from './notebook.js';
import type { OutputLine } from './repl-session.js';

/** A quoted suggestion (`use graph`), or the plain `requires: use algo` of a form that needs its module. */
const SUGGESTION = /`use ([^`\s]+)`|requires: use ([\w.-]+)/g;

/** Modules an unknown-name error suggests, in the order the message names them. */
export function missingImports(output: readonly OutputLine[]): string[] {
    const modules = output.filter(line => line.error)
        .flatMap(line => [...(line.inlineText ?? line.text).matchAll(SUGGESTION)].map(match => match[1] ?? match[2]));
    return [...new Set(modules)];
}

/** Error text with each suggestion as one unbreakable, unquoted phrase. */
export function importPhrases(text: string): { text: string; phrases: string[] } {
    const phrases: string[] = [];
    const shown = text.replace(SUGGESTION, (found: string, quoted: string | undefined, plain: string | undefined) => {
        const phrase = `use\u00a0${quoted ?? plain}`;
        phrases.push(phrase);
        return found.startsWith('requires: ') ? `requires: ${phrase}` : phrase;
    });
    return { text: shown, phrases };
}

function importedModule(line: string): string | undefined {
    return /^\s*use\s+"?([^"\s]+)/.exec(line)?.[1];
}

function preamble(cell: NotebookCell): boolean {
    return cell.source.split('\n').every(line => /^\s*(?:rem\b|#!|$)/.test(line));
}

/** Where `use module` keeps the imports sorted, never below the failing cell. Imports live in one
 * cell, so it joins that cell at `line`; with no imports it is a new cell after the leading comments. */
export function importPosition(cells: readonly NotebookCell[], module: string, failing: number): { index: number; line?: number } {
    const imports = cells.slice(0, failing).flatMap((cell, index) => cell.command ? []
        : cell.source.split('\n').flatMap((text, line) => importedModule(text) === undefined ? [] : [{ index, line, text }]));
    if (!imports.length) {
        const first = cells.findIndex((cell, index) => index >= failing || !cell.command && !preamble(cell));
        return { index: Math.min(first < 0 ? failing : first, failing) };
    }
    const after = imports.find(item => importedModule(item.text)! > module);
    const last = imports.at(-1)!;
    return after ? { index: after.index, line: after.line } : { index: last.index, line: last.line + 1 };
}
