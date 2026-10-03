import {
    formatValue, isRankArray, isRankSequence, isRankSequenceMask, isRankTable, typeName,
    type RankArray, type RankSequence, type RankValue,
} from '@arrrank/interpreter';
import { preview } from './preview.js';
import type { SequenceReplay } from './sequence-replay.js';

/** Cells or entries returned per axis when a request does not say. */
export const INSPECT_COUNT = 20;

/** The most one request may ask for per axis; a viewer pages for the rest. */
export const INSPECT_LIMIT = 1000;

/** Characters kept of one cell, so a long text cannot make a window heavy. */
const CELL_WIDTH = 40;

/** Characters kept of a scalar text value. */
const TEXT_LIMIT = 10_000;

/**
 * Which part of a value to read. A window covers two axes of an array, its
 * rows and its columns: the last two unless `axes` names others, in that
 * order, so `[2, 0]` lays axis 2 down the rows and axis 0 across. `fixed`
 * picks an index on every other axis, by axis number. Lists and collections
 * take `offset[0]` and `count[0]` as a page. Anything left out takes a
 * default, and anything out of range is clamped.
 */
export interface InspectRequest {
    readonly axes?: readonly number[];
    readonly fixed?: readonly number[];
    readonly offset?: readonly number[];
    readonly count?: readonly number[];
}

/** One value as a viewer draws it: the type and the text, nothing live. */
export interface InspectCell {
    readonly text: string;
    readonly type: string;
}

/** An axis of the window: how long it is, and the part that was read. */
export interface InspectAxis {
    readonly length: number;
    readonly offset: number;
    readonly count: number;
}

export interface InspectEntry {
    readonly key: string;
    readonly value: InspectCell;
}

export type InspectedValue =
    | { readonly kind: 'scalar'; readonly type: string; readonly text: string; readonly truncated: boolean }
    /**
     * `shape` is the whole array and `axes` the one or two axes the window
     * covers, so a vector has one axis and its rows have one cell each.
     * `fixed` is the index chosen on each leading axis.
     */
    | {
        readonly kind: 'array' | 'table'; readonly type: string; readonly shape: readonly number[];
        /** The axes laid out as rows and as columns, in that order; one for a vector. */
        readonly windowAxes: readonly number[];
        /** The index held on each remaining axis, in axis order. */
        readonly columns?: readonly string[]; readonly fixed: readonly number[];
        readonly axes: readonly InspectAxis[]; readonly cells: readonly (readonly InspectCell[])[];
    }
    /** Records, objects, sets, counters, queues and graphs, one page of entries. */
    | { readonly kind: 'entries'; readonly type: string; readonly size: number; readonly offset: number; readonly entries: readonly InspectEntry[] }
    /** The size is what the plan promises; `items` only what a reader has already forced. */
    | {
        readonly kind: 'sequence'; readonly type: string;
        readonly size: { readonly kind: 'exact' | 'unknown' | 'infinite'; readonly value?: string };
        readonly forced: number; readonly offset: number; readonly items: readonly InspectCell[];
        /** Whether the sequence has run to its end; unknown when the session keeps no record. */
        readonly finished?: boolean;
    }
    | { readonly kind: 'opaque'; readonly type: string; readonly text: string };

export type Inspection =
    | { readonly status: 'stale' }
    | ({ readonly status: 'ok' } & InspectedValue);

/** The answer for a reference that was released. */
export const STALE: Inspection = { status: 'stale' };

const clamp = (value: number | undefined, low: number, high: number, fallback: number): number =>
    Math.min(high, Math.max(low, Number.isFinite(value) ? Math.trunc(value!) : fallback));

/** A window on one axis of `length` cells. */
function axisWindow(length: number, offset: number | undefined, count: number | undefined): InspectAxis {
    const start = clamp(offset, 0, Math.max(0, length - 1), 0);
    return { length, offset: start, count: Math.max(0, Math.min(clamp(count, 0, INSPECT_LIMIT, INSPECT_COUNT), length - start)) };
}

function cellOf(value: RankValue | undefined): InspectCell {
    if (value === undefined) return { text: '.NA', type: 'missing' };
    return { text: preview(value, CELL_WIDTH).text, type: typeName(value) };
}

/** A cell a lazy array computes; its failure is a cell, not a failed window. */
function cellAt(read: () => RankValue | undefined): InspectCell {
    try { return cellOf(read()); }
    catch (error) { return { text: error instanceof Error ? error.message : String(error), type: 'error' }; }
}

/**
 * What a held value looks like, one window at a time. It reads the value as
 * it is: a sequence is never advanced, and only the cells asked for are
 * computed. A value kept by a generator shows the items already read from
 * it; the rest stays unread.
 */
export function inspectValue(value: RankValue, request: InspectRequest, replay?: Pick<SequenceReplay, 'forced'>): InspectedValue {
    if (isRankArray(value) && value.shape.length > 0) return inspectArray(value, request);
    if (isRankTable(value)) return inspectTable(value, request);
    if (isRankSequenceMask(value)) return { kind: 'sequence', type: 'sequence', size: { kind: 'unknown' }, forced: 0, offset: 0, items: [] };
    if (isRankSequence(value)) return inspectSequence(value, request, replay);
    if (typeof value === 'object') {
        const entries = collectionEntries(value);
        if (entries) return { kind: 'entries', type: typeName(value), ...pageOf(entries, request) };
    }
    const text = typeof value === 'string' ? value : formatValue(value);
    if (typeof value === 'object' && !isRankArray(value) && !isScalarObject(value)) return { kind: 'opaque', type: typeName(value), text };
    const truncated = text.length > TEXT_LIMIT;
    return { kind: 'scalar', type: typeName(value), text: truncated ? text.slice(0, TEXT_LIMIT) : text, truncated };
}

/** Collections a viewer opens as keyed entries. */
const COLLECTIONS = ['record', 'object', 'index', 'set', 'queue', 'tuple', 'counter', 'graph'];

/**
 * What a result row says about a value that can be opened, such as `integer [3 4]`,
 * or nothing for a value that is only its text. Cheap: it reads at most one cell.
 */
export function viewLabel(value: RankValue): string | undefined {
    if (isRankArray(value) && value.shape.length > 0) {
        const shape = `[${value.shape.join(' ')}]`;
        if (value.shape.some(length => length === 0)) return `array ${shape}`;
        let element: string | undefined;
        try { element = typeName((value.itemAt ?? ((index: number) => value.items[index]))(0)!); } catch { /* an unreadable cell is no type */ }
        return element ? `${element} ${shape}` : `array ${shape}`;
    }
    if (isRankTable(value)) return `table [${value.length} ${value.columns.length}]`;
    if (isRankSequenceMask(value) || isRankSequence(value)) return 'sequence';
    if (typeof value === 'object' && COLLECTIONS.includes(value.kind)) return typeName(value);
    return undefined;
}

/** Objects that stand for one value rather than a structure to open. */
function isScalarObject(value: Exclude<RankValue, bigint | number | boolean | string>): boolean {
    return ['label', 'missing', 'date', 'datetime', 'duration', 'error'].includes(value.kind);
}

function inspectArray(value: RankArray, request: InspectRequest): InspectedValue {
    const { shape } = value;
    const rank = shape.length;
    // Rows and columns are the last two axes unless the request names others; one axis cannot be both.
    let windowAxes = rank >= 2 ? [rank - 2, rank - 1] : [0];
    if (rank >= 2 && request.axes?.length) {
        const rowAxis = clamp(request.axes[0], 0, rank - 1, rank - 2);
        const columnAxis = clamp(request.axes[1], 0, rank - 1, rank - 1);
        if (rowAxis !== columnAxis) windowAxes = [rowAxis, columnAxis];
    }
    const held = shape.map((_, axis) => axis).filter(axis => !windowAxes.includes(axis));
    const fixed = held.map(axis => clamp(request.fixed?.[axis], 0, shape[axis] - 1, 0));
    const axes = windowAxes.map((axis, position) => axisWindow(shape[axis], request.offset?.[position], request.count?.[position]));
    // Row-major: a stride is the number of cells one step on that axis skips.
    const strides = shape.map((_, axis) => shape.slice(axis + 1).reduce((total, length) => total * length, 1));
    const base = held.reduce((total, axis, position) => total + fixed[position] * strides[axis], 0);
    const at = value.itemAt ?? ((index: number) => value.items[index]);
    const rows = axes[0];
    const columns = axes[1];
    const rowStride = strides[windowAxes[0]];
    const columnStride = columns ? strides[windowAxes[1]] : 0;
    const cells = Array.from({ length: rows.count }, (_, row) => {
        const start = base + (rows.offset + row) * rowStride;
        return columns
            ? Array.from({ length: columns.count }, (_, column) => cellAt(() => at(start + (columns.offset + column) * columnStride)))
            : [cellAt(() => at(start))];
    });
    // Column names belong to the last axis, so they only head columns laid along it.
    const names = value.columnNames && columns && windowAxes[1] === rank - 1
        ? value.columnNames.slice(columns.offset, columns.offset + columns.count) : undefined;
    return { kind: 'array', type: 'array', shape, windowAxes, ...(names ? { columns: names } : {}), fixed, axes, cells };
}

function inspectTable(table: Extract<RankValue, { kind: 'table' }>, request: InspectRequest): InspectedValue {
    const rows = axisWindow(table.length, request.offset?.[0], request.count?.[0]);
    const columns = axisWindow(table.columns.length, request.offset?.[1], request.count?.[1]);
    const names = table.names.slice(columns.offset, columns.offset + columns.count);
    const cells = Array.from({ length: rows.count }, (_, row) =>
        Array.from({ length: columns.count }, (_, column) =>
            cellAt(() => table.cell(rows.offset + row, columns.offset + column))));
    return { kind: 'table', type: 'table', shape: [table.length, table.columns.length], windowAxes: [0, 1], columns: names, fixed: [], axes: [rows, columns], cells };
}

function inspectSequence(value: RankSequence, request: InspectRequest, replay?: Pick<SequenceReplay, 'forced'>): InspectedValue {
    const { size } = value.plan;
    const forced = replay?.forced(value);
    const items = forced?.items ?? [];
    const window = axisWindow(items.length, request.offset?.[0], request.count?.[0]);
    return {
        kind: 'sequence', type: 'sequence',
        size: size.kind === 'exact' ? { kind: 'exact', value: size.value.toString() } : { kind: size.kind },
        forced: items.length, offset: window.offset,
        items: items.slice(window.offset, window.offset + window.count).map(cellOf),
        ...(forced ? { finished: forced.finished } : {}),
    };
}

/** The entries of a collection in the order it keeps them, or nothing for a value that has none. */
function collectionEntries(value: Exclude<RankValue, bigint | number | boolean | string>): InspectEntry[] | undefined {
    switch (value.kind) {
        case 'record': case 'object': case 'index':
            return [...value.entries].map(([key, item]) => ({ key, value: cellOf(item) }));
        case 'set':
            return [...value.entries.values()].map((item, index) => ({ key: String(index), value: cellOf(item) }));
        case 'queue': case 'tuple':
            return value.items.map((item, index) => ({ key: String(index), value: cellOf(item) }));
        case 'counter':
            return [...value.entries.values()].map(entry => ({
                key: preview(entry.value, CELL_WIDTH).text, value: { text: entry.count.toString(), type: 'integer' } }));
        case 'graph':
            return [...value.vertices].map(([key, vertex]) => ({
                key: preview(vertex, CELL_WIDTH).text,
                value: { text: (value.adjacency.get(key) ?? []).map(edge =>
                    preview(edge.target, CELL_WIDTH).text + (Number(edge.weight) === 1 ? '' : `:${edge.weight}`)).join(' '), type: 'list' } }));
        default: return undefined;
    }
}

function pageOf(entries: readonly InspectEntry[], request: InspectRequest) {
    const window = axisWindow(entries.length, request.offset?.[0], request.count?.[0]);
    return { size: entries.length, offset: window.offset, entries: entries.slice(window.offset, window.offset + window.count) };
}
