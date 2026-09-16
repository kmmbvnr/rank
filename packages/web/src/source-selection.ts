import { editableRows, type ScreenTarget } from '@arrrank/common/screen';
import type { Notebook } from '@arrrank/common/notebook';

/** Translate a native browser range back to source offsets, excluding gutters and results. */
export function sourceSelection(screen: HTMLElement, targets: readonly (ScreenTarget | undefined)[],
    notebook: Notebook, selection: Selection | null) {
    if (!selection?.rangeCount || selection.isCollapsed) return undefined;
    const range = selection.getRangeAt(0);
    let start: { cell: number; offset: number } | undefined;
    let end: { cell: number; offset: number } | undefined;
    for (const [index, row] of [...screen.children].entries()) {
        const target = targets[index];
        if (target?.kind !== 'source' || notebook.cells[target.cell].command
            || !target.points.length || !range.intersectsNode(row)) continue;
        const offset = (node: Node, at: number, fallback: number) => {
            if (!row.contains(node)) return fallback;
            const prefix = document.createRange();
            prefix.selectNodeContents(row);
            prefix.setEnd(node, at);
            const column = editableRows(prefix.toString(), Number.MAX_SAFE_INTEGER)[0].points.at(-1)!.column;
            return [...target.points].reverse().find(point => point.column <= column)?.offset
                ?? target.points[0].offset;
        };
        const from = offset(range.startContainer, range.startOffset, target.points[0].offset);
        const to = offset(range.endContainer, range.endOffset, target.points.at(-1)!.offset);
        start ??= { cell: target.cell, offset: from };
        end = { cell: target.cell, offset: to };
    }
    if (!start || !end) return undefined;
    const text = notebook.cells.slice(start.cell, end.cell + 1).flatMap((cell, index) => cell.command ? [] : [
        cell.source.slice(index === 0 ? start!.offset : 0, start!.cell + index === end!.cell ? end!.offset : undefined),
    ]).join('\n');
    return { start, end, text };
}
