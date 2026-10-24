import type { AstNode, CstNode } from 'langium';
import { isAssignmentStatement, type ScopeDiagnostic } from '@arrrank/language';
import { normalizeStackError } from './execution.js';
import { RankError } from './errors.js';

// Which file each parsed program came from. Keyed by the CST root, so every
// node of a loaded module reports its own file rather than the importer's.
const sourceIds = new WeakMap<object, string>();

export function registerSource(node: AstNode, id: string): void {
    if (node.$cstNode) sourceIds.set(node.$cstNode.root, id);
}

export function sourceIdOf(node: CstNode, fallback: string): string {
    return sourceIds.get(node.root) ?? fallback;
}

/** Keep the plan's origin in the protection message, even across later executions. */
export function planBindingNote(node: AstNode, fallback: string): string {
    const cst = node.$cstNode;
    if (!cst) return '';
    const { line, character } = cst.range.start;
    return ` Plan bound at ${sourceIdOf(cst, fallback)}:${line + 1}:${character + 1}.`;
}

/** Static writes use the same plan-origin note as persisted runtime protection. */
export function scopeDiagnosticMessage(diagnostic: ScopeDiagnostic, fallback: string): string {
    const source = diagnostic.source;
    return diagnostic.message + (isAssignmentStatement(source) && source.deferred
        ? planBindingNote(source, fallback) : '');
}

/** Attaches the first location an error passes on its way out; inner locations win. */
export function locateError(error: unknown, node: AstNode, fallback: string): unknown {
    error = normalizeStackError(error);
    if (error instanceof RankError && !error.location && node.$cstNode) {
        const cst = node.$cstNode;
        const start = cst.range.start;
        error.location = {
            sourceId: sourceIdOf(cst, fallback),
            line: start.line + 1,
            column: start.character + 1,
            sourceLine: cst.root.fullText.split(/\r?\n/)[start.line] ?? '',
        };
        error.sourceText = cst.root.fullText;
    }
    return error;
}
