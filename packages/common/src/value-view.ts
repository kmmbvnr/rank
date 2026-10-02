import type { InspectAxis, InspectCell, InspectedValue } from './value-inspection.js';

/** Where the window sits on one axis, so a viewer can draw a scroll bar and ask for the next page. */
export type ViewScroll = InspectAxis;

/** One leading axis of an array that the viewer holds still: "axis 0, index 1 of 2". */
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
        /** The index chosen on each leading axis of an array of rank above two. */
        readonly slice: readonly ViewSlice[];
    }
    | {
        readonly kind: 'list'; readonly title: string; readonly typeLine: string;
        readonly rows: readonly (readonly [string, string])[];
        readonly scroll: ViewScroll;
        /** For a sequence: what is known of its size and how much has been read. */
        readonly note?: string;
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
                slice: value.fixed.map((index, axis) => ({ axis, index, length: value.shape[axis] })),
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
            };
        }
    }
}
