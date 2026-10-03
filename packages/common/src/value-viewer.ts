import type { Key } from './key-router.js';
import type { InspectRequest, Inspection } from './value-inspection.js';
import { buildValueView, type ValueView } from './value-view.js';

/** Lines the viewer keeps for itself: the title, the column header and the footer. */
export const VIEWER_CHROME = 3;

/** Narrowest a column can be drawn, with its gap: how many to fetch for a width. */
const MIN_COLUMN = 3;

export type ViewerFetch = (request: InspectRequest) => Inspection | Promise<Inspection>;

/**
 * A value held open on screen: where its window sits and the view of it. Keys
 * move the window, and every move asks the session for just the cells that
 * come into view. The drawing lives in `viewerFrame`; this keeps no layout.
 */
export class ValueViewer {
    view!: ValueView;
    /** Whether closing returns to the result row: true when it was opened from the focused row, not by a tap. */
    restoreFocus = false;
    /** Columns the last frame had room for, so a page moves by what was seen. */
    shown = 1;
    private fixed: number[] = [];
    private offset = [0, 0];

    constructor(
        readonly title: string,
        /** The cell whose result this is, so closing returns to its row. */
        readonly cell: number,
        private readonly fetch: ViewerFetch,
        private readonly size: () => { rows: number; columns: number },
    ) {}

    /** Rows of cells that fit the screen. */
    get bodyRows(): number { return Math.max(1, this.size().rows - VIEWER_CHROME); }

    /** One window of the value, for a viewer that scrolls on its own (the web overlay). */
    window(request: InspectRequest): Inspection | Promise<Inspection> { return this.fetch(request); }

    /** Reads the first window. False when the value is no longer held. */
    async load(): Promise<boolean> { return this.read(); }

    private async read(): Promise<boolean> {
        const columns = Math.max(1, Math.ceil(this.size().columns / MIN_COLUMN));
        const inspection = await this.fetch({
            fixed: this.fixed, offset: this.offset, count: [this.bodyRows, columns],
        });
        if (inspection.status === 'stale') return false;
        this.view = buildValueView(this.title, inspection);
        if (this.view.kind === 'grid') this.fixed = this.view.slice.map(slice => slice.index);
        const [rows, cols] = this.axes();
        this.offset = [rows?.offset ?? 0, cols?.offset ?? 0];
        return true;
    }

    /** The row and column windows of the current view. */
    private axes() {
        const view = this.view;
        if (view.kind === 'grid') return [view.scroll.rows, view.scroll.columns] as const;
        if (view.kind === 'list') return [view.scroll, undefined] as const;
        return [undefined, undefined] as const;
    }

    /** Applies a key. `closed` means Esc, and `stale` means the value was released meanwhile. */
    async press(text: string, key: Key): Promise<'ok' | 'closed' | 'stale'> {
        if (key.name === 'escape' || !key.ctrl && !key.meta && text === 'q') return 'closed';
        const [rows, columns] = this.axes();
        const body = this.bodyRows;
        const lastRow = Math.max(0, (rows?.length ?? 0) - body);
        const lastColumn = Math.max(0, (columns?.length ?? 1) - 1);
        let [row, column] = this.offset;
        const fixed = [...this.fixed];
        if (key.name === 'up') row -= 1;
        else if (key.name === 'down') row += 1;
        else if (key.name === 'pageup') row -= Math.max(1, body - 1);
        else if (key.name === 'pagedown') row += Math.max(1, body - 1);
        else if (key.name === 'home') row = 0;
        else if (key.name === 'end') row = lastRow;
        else if ((key.name === 'left' || key.name === 'right') && columns) {
            column += (key.name === 'left' ? -1 : 1) * (key.shift ? Math.max(1, this.shown - 1) : 1);
        } else if ((text === '[' || text === ']') && fixed.length) {
            const length = this.view.kind === 'grid' ? this.view.slice[0].length : 1;
            fixed[0] = Math.min(length - 1, Math.max(0, fixed[0] + (text === '[' ? -1 : 1)));
        } else return 'ok';
        const next = [Math.min(lastRow, Math.max(0, row)), Math.min(lastColumn, Math.max(0, column))];
        if (next[0] === this.offset[0] && next[1] === this.offset[1] && fixed[0] === this.fixed[0]) return 'ok';
        const before = { offset: this.offset, fixed: this.fixed };
        this.offset = next;
        this.fixed = fixed;
        try {
            return await this.read() ? 'ok' : 'stale';
        } catch (error) {
            this.offset = before.offset;
            this.fixed = before.fixed;
            throw error;
        }
    }
}
