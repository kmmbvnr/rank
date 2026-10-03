import 'regular-table';
// Without this the table can only move by whole cells; with it, the scroll offset inside a cell moves the rows by pixels.
import 'regular-table/dist/css/sub-cell-scrolling.css';
import type { RegularTableElement } from 'regular-table';
import type { DataResponse } from 'regular-table/dist/esm/types.js';
import type { InspectCell, InspectedValue } from '@arrrank/common/value-inspection';
import type { ValueViewer } from '@arrrank/common/value-viewer';

const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
const closeIcon = icon('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z');
const NUMBER = /^-?(\d[\d_]*\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Rows and columns read per request, and how many blocks stay in memory. */
const ROW_BLOCK = 64;
const COLUMN_BLOCK = 16;
const KEPT_BLOCKS = 96;

interface Block {
    readonly cells: readonly (readonly InspectCell[])[];
    /** Column names of a table, or of an array that has them. */
    readonly columns?: readonly string[];
}

class Gone extends Error {}

/**
 * Whatever shape a value has, a grid sees rows of cells: an array or table as it is, a
 * record, collection or sequence as keyed rows. `read` turns one inspected window into those rows.
 */
function rowsOf(value: InspectedValue): Block {
    switch (value.kind) {
        case 'array': case 'table': return { cells: value.cells, ...(value.columns ? { columns: value.columns } : {}) };
        case 'entries': return { cells: value.entries.map(entry => [{ text: entry.key, type: 'key' }, entry.value]) };
        case 'sequence': return { cells: value.items.map((item, index) => [{ text: String(value.offset + index), type: 'key' }, item]) };
        default: return { cells: [[{ text: value.text, type: value.type }]] };
    }
}

/**
 * A value held open over the notebook: the same view model as the terminal viewer, drawn as a
 * table that only ever holds the cells on screen. The data stays in the worker; each block of
 * rows and columns is read through `inspect` when scrolling brings it into view.
 */
export class ValueOverlay {
    private readonly dialog = document.createElement('dialog');
    private readonly title = document.createElement('h2');
    private readonly type = document.createElement('p');
    private readonly axesPanel = document.createElement('div');
    private readonly more = document.createElement('footer');
    private readonly moreStatus = document.createElement('span');
    private readonly moreButton = document.createElement('button');
    private readonly table = document.createElement('regular-table') as RegularTableElement;
    private viewer?: ValueViewer;
    /** The shape of an array, the axes laid out as rows and columns, and the index held on every axis. */
    private shape: number[] = [];
    private axes: [number, number] = [0, 1];
    private fixed: number[] = [];
    private blocks = new Map<string, Promise<Block>>();
    private ready = new Map<string, Block>();
    private rows = 0;
    private columns = 1;
    private entries = false;
    private opened = 0;

    constructor(private readonly onClose: (message?: string) => void) {
        this.dialog.id = 'value-viewer';
        this.dialog.setAttribute('aria-labelledby', 'value-viewer-title');
        this.title.id = 'value-viewer-title';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'viewer-close';
        close.innerHTML = closeIcon;
        close.setAttribute('aria-label', 'Close viewer');
        close.onclick = () => this.dialog.close();
        const name = document.createElement('div');
        name.className = 'viewer-name';
        name.append(this.title, this.type);
        const header = document.createElement('header');
        header.append(close, name);
        this.axesPanel.className = 'viewer-axes';
        this.axesPanel.hidden = true;
        const body = document.createElement('div');
        body.className = 'viewer-body';
        // Focus the table area, not the close button, so opening shows no focus ring.
        body.tabIndex = -1;
        body.autofocus = true;
        body.append(this.table);
        // A sequence that is still being generated can be read further, a bounded number at a time.
        this.more.className = 'viewer-more';
        this.more.hidden = true;
        this.moreButton.type = 'button';
        this.moreButton.textContent = 'Read more';
        this.moreButton.onclick = () => void this.readMore();
        this.more.append(this.moreStatus, this.moreButton);
        this.dialog.append(header, this.axesPanel, body, this.more);
        document.body.append(this.dialog);
        // Escape ends as a close; Android's Back reaches `rankBack` through the activity.
        this.dialog.addEventListener('close', () => {
            const was = this.viewer;
            this.viewer = undefined;
            this.blocks.clear();
            this.ready.clear();
            if (was) this.onClose();
        });
        // The table sizes itself from its container, which has no height until the dialog is laid out
        // (and changes with the phone's rotation and bars), so it draws again whenever the body resizes.
        new ResizeObserver(() => { if (this.viewer) void this.table.draw(); }).observe(body);
        this.table.setDataListener((x0, y0, x1, y1) => this.window(x0, y0, x1, y1), { column_classes: true });
        this.table.addStyleListener(() => this.style());
    }

    get isOpen(): boolean { return this.dialog.open; }

    /** Shows `viewer`, or keeps showing it when it is already the one on screen. */
    show(viewer: ValueViewer): void {
        if (this.viewer === viewer && this.dialog.open) return;
        this.viewer = viewer;
        this.opened++;
        const view = viewer.view;
        this.title.textContent = view.title;
        this.type.textContent = view.typeLine;
        this.shape = view.kind === 'grid' ? [...view.shape] : [];
        this.axes = view.kind === 'grid' && view.windowAxes.length === 2 ? [view.windowAxes[0], view.windowAxes[1]] : [0, 1];
        this.fixed = this.shape.map(() => 0);
        if (view.kind === 'grid') for (const slice of view.slice) this.fixed[slice.axis] = slice.index;
        this.entries = view.kind !== 'grid';
        this.rows = view.kind === 'grid' ? view.scroll.rows.length : view.kind === 'list' ? view.scroll.length : 1;
        this.columns = view.kind === 'grid' ? view.scroll.columns?.length ?? 1 : view.kind === 'list' ? 2 : 1;
        this.blocks.clear();
        this.ready.clear();
        this.renderAxes();
        this.renderMore();
        if (!this.dialog.open) this.dialog.showModal();
        this.table.scrollTop = 0;
        this.table.scrollLeft = 0;
        void this.table.draw();
        // Once the dialog has a size, fill the screen without waiting for a touch.
        requestAnimationFrame(() => requestAnimationFrame(() => { if (this.viewer) void this.table.draw(); }));
    }

    /** Closes the viewer for Android's Back; false when none is open, so Back does what it always did. */
    back(): boolean {
        if (!this.dialog.open) return false;
        this.dialog.close();
        return true;
    }

    hide(): void {
        if (!this.dialog.open) return;
        this.viewer = undefined;
        this.dialog.close();
    }

    /** The read-more bar: only for a sequence that has not ended and can be read further. */
    private renderMore(): void {
        const view = this.viewer?.view;
        const open = view?.kind === 'list' && !!view.more;
        this.more.hidden = !open;
        if (!open) return;
        this.moreStatus.textContent = [view.note, this.viewer?.readNote].filter(Boolean).join(' · ');
        this.moreButton.disabled = false;
    }

    private async readMore(): Promise<void> {
        const viewer = this.viewer;
        if (!viewer || this.moreButton.disabled) return;
        this.moreButton.disabled = true;
        this.moreStatus.textContent = 'Reading…';
        try {
            const outcome = await viewer.more();
            if (this.viewer !== viewer) return;
            if (outcome === 'stale') {
                this.viewer = undefined;
                this.dialog.close();
                this.onClose('That value is gone · run the cell again');
                return;
            }
            const view = viewer.view;
            this.rows = view.kind === 'list' ? view.scroll.length : this.rows;
            this.renderMore();
            void this.table.draw();
        } catch {
            if (this.viewer === viewer) this.moreStatus.textContent = 'Could not read more';
            this.moreButton.disabled = false;
        }
    }

    /** Starts again from the top-left of whatever the axes now show. */
    private redraw(): void {
        this.blocks.clear();
        this.ready.clear();
        this.rows = this.shape[this.axes[0]];
        this.columns = this.shape[this.axes[1]];
        this.table.scrollTop = 0;
        this.table.scrollLeft = 0;
        this.renderAxes();
        void this.table.draw();
    }

    /** Puts `axis` on the rows or the columns; when it was on the other, the two trade places. */
    private lay(axis: number, position: 0 | 1): void {
        if (this.axes[position] === axis) return;
        const other = (1 - position) as 0 | 1;
        if (this.axes[other] === axis) this.axes[other] = this.axes[position];
        this.axes[position] = axis;
        this.redraw();
    }

    /**
     * For an array of rank above two: which axis runs down the rows and which across the columns,
     * and a stepper for the index held on every other axis.
     */
    private renderAxes(): void {
        const view = this.viewer?.view;
        const rank = view?.kind === 'grid' ? view.shape.length : 0;
        this.axesPanel.hidden = rank <= 2;
        if (rank <= 2) return this.axesPanel.replaceChildren();
        const group = (label: string, position: 0 | 1) => {
            const row = document.createElement('div');
            row.className = 'viewer-axis-row';
            const name = document.createElement('span');
            name.textContent = label;
            row.append(name);
            for (let axis = 0; axis < rank; axis++) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = `${axis} · ${this.shape[axis]}`;
                button.setAttribute('aria-label', `${label} on axis ${axis}`);
                button.setAttribute('aria-pressed', String(this.axes[position] === axis));
                button.onclick = () => this.lay(axis, position);
                row.append(button);
            }
            return row;
        };
        const steppers = this.shape.map((length, axis) => axis).filter(axis => !this.axes.includes(axis)).map(axis => {
            const length = this.shape[axis];
            const row = document.createElement('div');
            row.className = 'viewer-stepper';
            const label = document.createElement('span');
            const step = (delta: number) => {
                const index = Math.min(length - 1, Math.max(0, this.fixed[axis] + delta));
                if (index === this.fixed[axis]) return;
                this.fixed[axis] = index;
                this.blocks.clear();
                this.ready.clear();
                this.renderAxes();
                void this.table.draw();
            };
            const button = (text: string, aria: string, delta: number) => {
                const element = document.createElement('button');
                element.type = 'button';
                element.textContent = text;
                element.setAttribute('aria-label', aria);
                element.disabled = delta < 0 ? this.fixed[axis] <= 0 : this.fixed[axis] >= length - 1;
                element.onclick = () => step(delta);
                return element;
            };
            label.textContent = `axis ${axis} · ${this.fixed[axis] + 1} of ${length}`;
            row.append(button('‹', `Previous index on axis ${axis}`, -1), label, button('›', `Next index on axis ${axis}`, 1));
            return row;
        });
        this.axesPanel.replaceChildren(group('rows', 0), group('columns', 1), ...steppers);
    }

    private key(rowBlock: number, columnBlock: number): string {
        return `${this.axes.join('x')}:${this.fixed.join(',')}:${rowBlock}:${columnBlock}`;
    }

    private block(rowBlock: number, columnBlock: number): Promise<Block> {
        const key = this.key(rowBlock, columnBlock);
        const known = this.blocks.get(key);
        if (known) {
            // Most recently used last, so the oldest block is the one to drop.
            this.blocks.delete(key);
            this.blocks.set(key, known);
            return known;
        }
        const viewer = this.viewer!;
        const generation = this.opened;
        const loading = (async () => {
            const inspection = await viewer.window({
                axes: this.axes, fixed: this.fixed, offset: [rowBlock * ROW_BLOCK, columnBlock * COLUMN_BLOCK],
                count: [ROW_BLOCK, COLUMN_BLOCK],
            });
            if (inspection.status === 'stale') throw new Gone();
            const { status: _status, ...value } = inspection;
            const block = rowsOf(value);
            if (generation === this.opened) this.ready.set(key, block);
            return block;
        })();
        this.blocks.set(key, loading);
        loading.catch(() => this.blocks.delete(key));
        while (this.blocks.size > KEPT_BLOCKS) {
            const oldest = this.blocks.keys().next().value!;
            this.blocks.delete(oldest);
            this.ready.delete(oldest);
        }
        return loading;
    }

    private async window(x0: number, y0: number, x1: number, y1: number): Promise<DataResponse> {
        const generation = this.opened;
        const empty: DataResponse = { data: [], num_rows: this.rows, num_columns: this.columns };
        if (!this.viewer) return empty;
        const lastRow = Math.min(y1, this.rows) - 1;
        const lastColumn = Math.min(x1, this.columns) - 1;
        if (lastRow < y0 || lastColumn < x0) return empty;
        const wanted: [number, number][] = [];
        for (let rowBlock = Math.floor(y0 / ROW_BLOCK); rowBlock <= Math.floor(lastRow / ROW_BLOCK); rowBlock++)
            for (let columnBlock = Math.floor(x0 / COLUMN_BLOCK); columnBlock <= Math.floor(lastColumn / COLUMN_BLOCK); columnBlock++)
                wanted.push([rowBlock, columnBlock]);
        let loaded: Block[];
        try {
            loaded = await Promise.all(wanted.map(([rowBlock, columnBlock]) => this.block(rowBlock, columnBlock)));
        } catch (error) {
            if (error instanceof Gone && generation === this.opened) {
                this.viewer = undefined;
                this.dialog.close();
                this.onClose('That value is gone · run the cell again');
            }
            return empty;
        }
        if (generation !== this.opened) return empty;
        const byBlock = new Map(wanted.map(([rowBlock, columnBlock], index) => [`${rowBlock}:${columnBlock}`, loaded[index]]));
        const cell = (x: number, y: number): InspectCell | undefined =>
            byBlock.get(`${Math.floor(y / ROW_BLOCK)}:${Math.floor(x / COLUMN_BLOCK)}`)
                ?.cells[y % ROW_BLOCK]?.[x % COLUMN_BLOCK];
        const columnName = (x: number): string => {
            if (this.entries) return x === 0 ? 'key' : 'value';
            const block = byBlock.get(`${Math.floor(y0 / ROW_BLOCK)}:${Math.floor(x / COLUMN_BLOCK)}`);
            return block?.columns?.[x % COLUMN_BLOCK] ?? (this.columns === 1 ? 'value' : String(x));
        };
        const xs = Array.from({ length: lastColumn - x0 + 1 }, (_, index) => x0 + index);
        const ys = Array.from({ length: lastRow - y0 + 1 }, (_, index) => y0 + index);
        return {
            num_rows: this.rows,
            num_columns: this.columns,
            data: xs.map(x => ys.map(y => cell(x, y)?.text ?? '')),
            row_headers: ys.map(y => [String(y)]),
            column_headers: xs.map(x => [columnName(x)]),
        };
    }

    /** Right-aligns numbers and dims missing cells, using what the worker said about each cell. */
    private style(): void {
        for (const element of this.table.querySelectorAll<HTMLTableCellElement>('tbody td')) {
            const meta = this.table.getMeta(element);
            if (!meta || meta.type !== 'body') continue;
            const cell = this.ready.get(this.key(Math.floor(meta.y / ROW_BLOCK), Math.floor(meta.x / COLUMN_BLOCK)))
                ?.cells[meta.y % ROW_BLOCK]?.[meta.x % COLUMN_BLOCK];
            element.classList.toggle('viewer-number', !!cell && cell.type !== 'key' && NUMBER.test(cell.text.trim()));
            element.classList.toggle('viewer-missing', cell?.type === 'missing');
            element.classList.toggle('viewer-error', cell?.type === 'error');
        }
    }
}
