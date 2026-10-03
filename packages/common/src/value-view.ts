import type { InspectAxis, InspectCell, InspectedValue } from './value-inspection.js';

/** Where the window sits on one axis, so a viewer can draw a scroll bar and ask for the next page. */
export type ViewScroll = InspectAxis;

/** One axis of an array that the viewer holds still: "axis 0, index 1 of 2". */
export interface ViewSlice {
    readonly axis: number;
    readonly index: number;
    readonly length: number;
}

/**
 * What a viewer draws, whether in a terminal or in HTML: plain strings and
 * numbers, no values and no layout. `grid` is rows by columns, `list` is
 * keyed rows, `text` is a value that is only its text.
 */
export type ValueView =
    | { readonly kind: 'text'; readonly title: string; readonly typeLine: string; readonly text: string }
    | {
        readonly kind: 'grid'; readonly title: string; readonly typeLine: string;
        readonly rowLabels: readonly string[]; readonly columnLabels: readonly string[];
        readonly cells: readonly (readonly string[])[];
        /** The row and column windows; a vector has no column window. */
        readonly scroll: { readonly rows: ViewScroll; readonly columns?: ViewScroll };
        /** The index held on each axis that is not a row or column axis, in axis order. */
        readonly slice: readonly ViewSlice[];
        /** The shape of the whole array and the axes laid out as rows and columns, for an axis picker. */
        readonly shape: readonly number[];
        readonly windowAxes: readonly number[];
    }
    | {
        readonly kind: 'list'; readonly title: string; readonly typeLine: string;
        readonly rows: readonly (readonly [string, string])[];
        readonly scroll: ViewScroll;
        /** For a sequence: what is known of its size and how much has been read. */
        readonly note?: string;
        /** A sequence whose generator can be read further ahead of whatever consumes it. */
        readonly more?: boolean;
    };

/** The element type when every cell in the window has one, otherwise nothing is claimed. */
function commonType(cells: readonly (readonly InspectCell[])[]): string | undefined {
    const types = new Set(cells.flat().map(cell => cell.type));
    return types.size === 1 ? [...types][0] : undefined;
}

const range = (offset: number, count: number): string[] => Array.from({ length: count }, (_, index) => String(offset + index));

/** The view of one window of a held value, titled by the name a viewer shows. */
export function buildValueView(title: string, value: InspectedValue): ValueView {
    switch (value.kind) {
        case 'scalar': return { kind: 'text', title, typeLine: value.type, text: value.text };
        case 'opaque': return { kind: 'text', title, typeLine: value.type, text: value.text };
        case 'array': case 'table': {
            const [rows, columns] = value.axes;
            const element = commonType(value.cells);
            const shape = `[${value.shape.join(' ')}]`;
            return {
                kind: 'grid', title,
                typeLine: [value.type, element, shape].filter(Boolean).join(' · '),
                rowLabels: range(rows.offset, rows.count),
                columnLabels: value.columns ? [...value.columns]
                    : columns ? range(columns.offset, columns.count) : [''],
                cells: value.cells.map(row => row.map(cell => cell.text)),
                scroll: columns ? { rows, columns } : { rows },
                slice: value.shape.map((_, axis) => axis).filter(axis => !value.windowAxes.includes(axis))
                    .map((axis, position) => ({ axis, index: value.fixed[position], length: value.shape[axis] })),
                shape: value.shape, windowAxes: value.windowAxes,
            };
        }
        case 'entries':
            return {
                kind: 'list', title, typeLine: `${value.type} · ${value.size}`,
                rows: value.entries.map(entry => [entry.key, entry.value.text] as const),
                scroll: { length: value.size, offset: value.offset, count: value.entries.length },
            };
        case 'sequence': {
            const size = value.size.kind === 'exact' ? `${value.size.value} values`
                : value.size.kind === 'infinite' ? 'unbounded' : 'size unknown';
            return {
                kind: 'list', title, typeLine: `sequence · ${size}`,
                rows: value.items.map((item, index) => [String(value.offset + index), item.text] as const),
                scroll: { length: value.forced, offset: value.offset, count: value.items.length },
                note: `${value.forced} read so far${value.finished ? ', ended' : ''}`,
                ...(value.finished === false ? { more: true } : {}),
            };
        }
    }
}

/** The view as plain lines, for a screen with no viewer of its own yet. */
export function viewText(view: ValueView): string {
    const lines = [view.title, view.typeLine, ''];
    if (view.kind === 'text') lines.push(view.text);
    else if (view.kind === 'list') {
        const width = Math.max(0, ...view.rows.map(([key]) => key.length));
        lines.push(...view.rows.map(([key, text]) => `${key.padEnd(width)}  ${text}`));
        if (view.note) lines.push('', view.note);
        if (view.scroll.length > view.scroll.count) lines.push(`${view.scroll.offset + 1}–${view.scroll.offset + view.scroll.count} of ${view.scroll.length}`);
    } else {
        for (const { axis, index, length } of view.slice) lines.push(`axis ${axis}: ${index} of ${length}`);
        const table = [view.columnLabels.map(String), ...view.cells];
        const widths = view.columnLabels.map((_, column) => Math.max(...table.map(row => (row[column] ?? '').length)));
        const labelWidth = Math.max(0, ...view.rowLabels.map(label => label.length));
        lines.push(...table.map((row, index) =>
            ((index === 0 ? '' : view.rowLabels[index - 1]).padEnd(labelWidth) + '  '
                + row.map((cell, column) => cell.padStart(widths[column])).join('  ')).trimEnd()));
        const rows = view.scroll.rows;
        if (rows.length > rows.count) lines.push('', `rows ${rows.offset + 1}–${rows.offset + rows.count} of ${rows.length}`);
    }
    return lines.join('\n');
}
