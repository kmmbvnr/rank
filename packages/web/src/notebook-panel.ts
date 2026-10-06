import { NotebookHistory } from './notebook-history.js';
import { notebookTitle, type HistoryPage, type NotebookMeta } from './notebook-store.js';

export class NotebookPanel {
    readonly dialog = document.createElement('dialog');
    private readonly list: HTMLElement;
    private readonly status: HTMLElement;
    private readonly more: HTMLButtonElement;
    private next?: HistoryPage['next'];
    private loading = false;
    private generation = 0;
    private lastDate = '';
    private readonly actions = document.createElement('div');
    private readonly renameDialog = document.createElement('dialog');
    private readonly deleteDialog = document.createElement('dialog');
    private selected?: NotebookMeta;
    constructor(private readonly history: NotebookHistory,
        private readonly open: (id?: string) => Promise<void>,
        importFile: () => Promise<void>,
        exportFile: () => Promise<void>,
        private readonly beforeOpen: () => void,
        private readonly afterClose: () => void) {
        this.dialog.id = 'notebook-panel';
        this.dialog.setAttribute('aria-label', 'Notebook history');
        this.dialog.innerHTML = `<header><button class="history-brand" type="button" aria-label="Close notebook history">RANK</button></header>
            <button type="button" id="new-notebook">New notebook</button>
            <p class="history-status" role="status"></p><div class="history-scroll"><div class="history-list"></div>
            <button type="button" class="history-more" hidden>Load more</button></div>
            <footer><button type="button" id="import-notebook">Import .ra</button><button type="button" id="export-notebook">Export .ra</button></footer>`;
        document.body.append(this.dialog);
        this.actions.className = 'history-actions';
        this.actions.setAttribute('popover', 'auto');
        this.actions.setAttribute('role', 'menu');
        this.actions.innerHTML = '<button type="button" role="menuitem">Rename</button><button type="button" role="menuitem" class="history-delete">Delete</button>';
        this.dialog.append(this.actions);
        this.renameDialog.className = this.deleteDialog.className = 'history-edit';
        this.renameDialog.setAttribute('aria-label', 'Rename notebook');
        this.renameDialog.innerHTML = `<form><h2>Rename notebook</h2><input aria-label="Notebook title" maxlength="120" autocomplete="off"><p role="status"></p><div class="history-edit-buttons"><button type="button">Cancel</button><button type="submit">Save</button></div></form>`;
        this.deleteDialog.setAttribute('aria-label', 'Delete notebook');
        this.deleteDialog.innerHTML = `<h2>Delete notebook?</h2><p class="history-delete-name"></p><p role="status"></p><div class="history-edit-buttons"><button type="button">Cancel</button><button type="button" class="history-delete">Delete</button></div>`;
        document.body.append(this.renameDialog, this.deleteDialog);
        this.actions.querySelector<HTMLButtonElement>('[role="menuitem"]')!.onclick = () => {
            this.actions.hidePopover();
            const input = this.renameDialog.querySelector('input')!;
            input.value = this.selected!.title;
            this.renameDialog.querySelector('[role="status"]')!.textContent = '';
            this.renameDialog.showModal();
            input.select();
        };
        this.actions.querySelector<HTMLButtonElement>('.history-delete')!.onclick = () => {
            this.actions.hidePopover();
            this.deleteDialog.querySelector('.history-delete-name')!.textContent = this.selected!.title;
            this.deleteDialog.querySelector('[role="status"]')!.textContent = '';
            this.deleteDialog.showModal();
        };
        this.renameDialog.querySelector('form')!.onsubmit = event => {
            event.preventDefault();
            const meta = this.selected!;
            const title = this.renameDialog.querySelector('input')!.value;
            void this.action(async () => {
                await this.history.rename(meta, title);
                await this.refresh();
                this.renameDialog.close();
            }, false, this.renameDialog.querySelector<HTMLElement>('[role="status"]')!);
        };
        this.deleteDialog.querySelector<HTMLButtonElement>('.history-delete')!.onclick = () => {
            const meta = this.selected!;
            void this.action(async () => {
                await this.history.flush();
                if (meta.id === this.history.current?.id) await this.open();
                await this.history.store.remove(meta.id);
                await this.refresh();
                this.deleteDialog.close();
            }, false, this.deleteDialog.querySelector<HTMLElement>('[role="status"]')!);
        };
        for (const edit of [this.renameDialog, this.deleteDialog]) {
            edit.querySelector<HTMLButtonElement>('button')!.onclick = () => edit.close();
            edit.addEventListener('click', event => {
                if (event.target !== edit) return;
                const rect = edit.getBoundingClientRect();
                if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) edit.close();
            });
        }
        this.list = this.dialog.querySelector('.history-list')!;
        this.status = this.dialog.querySelector('.history-status')!;
        this.more = this.dialog.querySelector('.history-more')!;
        this.dialog.querySelector<HTMLButtonElement>('[aria-label="Close notebook history"]')!.onclick = () => this.close();
        this.dialog.querySelector<HTMLButtonElement>('#new-notebook')!.onclick = () => void this.action(() => this.open());
        this.dialog.querySelector<HTMLButtonElement>('#import-notebook')!.onclick = () => void this.action(importFile);
        this.dialog.querySelector<HTMLButtonElement>('#export-notebook')!.onclick = () => void this.action(exportFile, false);
        this.more.onclick = () => void this.load();
        this.dialog.querySelector('.history-scroll')!.addEventListener('scroll', event => {
            const element = event.currentTarget as HTMLElement;
            if (element.scrollHeight - element.scrollTop - element.clientHeight < 120 && this.next) void this.load();
        });
        this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
        this.dialog.addEventListener('click', event => {
            if (event.target !== this.dialog) return;
            const rect = this.dialog.getBoundingClientRect();
            if (event.clientX > rect.right || event.clientY > rect.bottom || event.clientY < rect.top) this.close();
        });
    }
    async show(): Promise<void> {
        if (this.dialog.open) return;
        this.beforeOpen();
        this.dialog.showModal();
        await this.action(async () => { await this.history.flush(); await this.refresh(); }, false);
    }
    close(): boolean {
        if (this.renameDialog.open) { this.renameDialog.close(); return true; }
        if (this.deleteDialog.open) { this.deleteDialog.close(); return true; }
        if (this.actions.matches(':popover-open')) { this.actions.hidePopover(); return true; }
        if (!this.dialog.open) return false;
        this.dialog.close();
        this.afterClose();
        return true;
    }
    private async action(action: () => Promise<void>, close = true, status: HTMLElement = this.status): Promise<void> {
        status.textContent = '';
        this.dialog.setAttribute('aria-busy', 'true');
        const buttons = [this.dialog, this.renameDialog, this.deleteDialog].flatMap(dialog => [...dialog.querySelectorAll<HTMLButtonElement>('button')]);
        buttons.forEach(button => { button.disabled = true; });
        try { await action(); if (close) this.close(); }
        catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
        finally {
            buttons.forEach(button => { button.disabled = false; });
            this.dialog.setAttribute('aria-busy', 'false');
        }
    }
    private async refresh(): Promise<void> {
        this.generation++;
        this.list.replaceChildren();
        this.lastDate = '';
        this.next = undefined;
        await this.load(true);
    }
    private async load(first = false): Promise<void> {
        if (this.loading || !first && !this.next) return;
        this.loading = true;
        this.more.disabled = true;
        const generation = this.generation;
        try {
            const page = await this.history.store.list(first ? undefined : this.next);
            if (generation !== this.generation) return;
            for (const meta of page.items) {
                // Repair older automatic titles as their page is loaded.
                if (!meta.manual && /^use(?:\s|$)/.test(meta.title)) {
                    const book = await this.history.store.get(meta.id);
                    if (book) {
                        meta.title = notebookTitle(book.snapshot);
                        await this.history.store.save({ ...book, title: meta.title });
                    }
                }
                if (generation !== this.generation) return;
                this.row(meta);
            }
            this.next = page.next;
            this.more.hidden = !this.next;
            if (first && !page.items.length) this.status.textContent = 'Your notebooks will appear here.';
        } catch (error) { this.status.textContent = `Cannot load history: ${String(error)}`; }
        finally { this.loading = false; this.more.disabled = false; }
    }
    private row(meta: NotebookMeta): void {
        const day = new Date(meta.updated).toDateString();
        if (day !== this.lastDate) {
            const label = document.createElement('p');
            label.className = 'history-date';
            const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
            label.textContent = day === new Date().toDateString() ? 'Today' : day === yesterday.toDateString()
                ? 'Yesterday' : new Date(meta.updated).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            this.list.append(label);
            this.lastDate = day;
        }
        const row = document.createElement('div');
        row.className = 'history-row';
        row.dataset.id = meta.id;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-title';
        button.textContent = meta.title;
        button.title = meta.title;
        if (meta.id === this.history.current?.id) button.setAttribute('aria-current', 'page');
        button.onclick = () => void this.action(() => this.open(meta.id));
        const options = document.createElement('button');
        options.type = 'button';
        options.className = 'history-options';
        options.setAttribute('aria-label', 'Notebook options');
        options.setAttribute('aria-haspopup', 'menu');
        options.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
        options.onclick = () => {
            this.selected = meta;
            const rect = options.getBoundingClientRect();
            this.actions.style.left = Math.max(12, rect.right - 180) + 'px';
            this.actions.style.top = Math.min(rect.bottom, window.innerHeight - 130) + 'px';
            this.actions.showPopover();
        };
        row.append(button, options);
        this.list.append(row);
    }
}
