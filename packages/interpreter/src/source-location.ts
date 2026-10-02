import type { AstNode, CstNode } from 'langium';
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
    }
    return error;
}
