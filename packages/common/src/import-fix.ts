import type { NotebookCell } from './notebook.js';
import type { OutputLine } from './repl-session.js';

const SUGGESTION = /`use ([^`\s]+)`/g;

/** Modules an unknown-name error suggests, in the order the message names them. */
export function missingImports(output: readonly OutputLine[]): string[] {
    const modules = output.filter(line => line.error)
        .flatMap(line => [...(line.inlineText ?? line.text).matchAll(SUGGESTION)].map(match => match[1]));
    return [...new Set(modules)];
}

/** Error text with each suggestion as one unbreakable, unquoted phrase. */
export function importPhrases(text: string): { text: string; phrases: string[] } {
    const phrases: string[] = [];
    const shown = text.replace(SUGGESTION, (_, module: string) => {
        const phrase = `use ${module}`;
        phrases.push(phrase);
        return phrase;
    });
    return { text: shown, phrases };
}

function importedModule(cell: NotebookCell): string | undefined {
    return /^\s*use\s+"?([^"\s]+)/.exec(cell.source)?.[1];
}

function preamble(cell: NotebookCell): boolean {
    return cell.source.split('\n').every(line => /^\s*(?:rem\b|#!|$)/.test(line));
}

/** The first cell at or after which `use module` keeps the imports sorted,
 * never below the failing cell; with no imports, after the leading comments. */
export function importPosition(cells: readonly NotebookCell[], module: string, failing: number): number {
    const imports = cells.slice(0, failing).flatMap((cell, index) =>
        cell.command || importedModule(cell) === undefined ? [] : [index]);
    if (!imports.length) {
        const first = cells.findIndex((cell, index) => index >= failing || !cell.command && !preamble(cell));
        return Math.min(first < 0 ? failing : first, failing);
    }
    const after = imports.find(index => importedModule(cells[index])! > module);
    return after ?? imports.at(-1)! + 1;
}
