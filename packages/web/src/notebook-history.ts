import { notebookSource, notebookTitle, type NotebookDraft, type NotebookMeta, type NotebookStore, type SavedNotebook } from './notebook-store.js';

/** Serializes writes and flushes the latest editor snapshot before any document transition. */
export class NotebookHistory {
    current?: SavedNotebook;
    private written = '';
    private pending?: NotebookDraft;
    private timer?: ReturnType<typeof setTimeout>;
    private writes = Promise.resolve();
    constructor(readonly store: NotebookStore, private readonly onError: (error: unknown) => void,
        private readonly onSaved: () => void = () => {}) {}

    async initialize(legacy: NotebookDraft | undefined, activeId: string | null): Promise<NotebookDraft> {
        // A stable migration ID makes retrying after a crash safe.
        let migrated = await this.store.get('legacy');
        if (!migrated && legacy && notebookSource(legacy).trim()) {
            migrated = this.create(legacy, 'legacy');
            await this.store.save(migrated);
        }
        const recent = activeId ? await this.store.get(activeId) : undefined;
        const latest = (await this.store.list()).items[0];
        const book = recent ?? (latest ? await this.store.get(latest.id) : undefined) ?? migrated
            ?? this.create({ cells: [], draft: '' });
        await this.store.save(book);
        this.use(book);
        return book.snapshot;
    }
    private create(snapshot: NotebookDraft, id: string = crypto.randomUUID()): SavedNotebook {
        const now = Date.now();
        return { id, title: notebookTitle(snapshot), manual: false, created: now, updated: now, snapshot };
    }
    private use(book: SavedNotebook): void {
        this.current = book;
        this.written = JSON.stringify(book.snapshot);
        this.pending = undefined;
    }
    schedule(snapshot: NotebookDraft): void {
        if (!this.current || JSON.stringify(snapshot) === (this.pending ? JSON.stringify(this.pending) : this.written)) return;
        this.pending = snapshot;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.flush().catch(this.onError); }, 180);
    }
    async flush(): Promise<void> {
        clearTimeout(this.timer);
        const write = this.writes.catch(() => {}).then(async () => {
            const snapshot = this.pending;
            const book = this.current;
            if (!snapshot || !book) return;
            const next = { ...book, snapshot, updated: Date.now(), title: book.manual ? book.title : notebookTitle(snapshot) };
            await this.store.save(next);
            this.current = next;
            this.written = JSON.stringify(snapshot);
            if (this.pending === snapshot) this.pending = undefined;
            this.onSaved();
        });
        this.writes = write;
        await write;
    }
    async open(id: string | undefined, restore: (snapshot: NotebookDraft) => Promise<void>): Promise<void> {
        await this.flush();
        const book = id ? await this.store.get(id) : this.create({ cells: [], draft: '' });
        if (!book) throw new Error('Notebook is no longer available');
        if (!id) await this.store.save(book);
        await restore(book.snapshot);
        this.use(book);
    }
    async rename(meta: NotebookMeta, title: string): Promise<void> {
        await this.flush();
        const book = meta.id === this.current?.id ? this.current : await this.store.get(meta.id);
        if (!book) throw new Error('Notebook is no longer available');
        const next = { ...book, manual: !!title.trim(), title: title.trim() || notebookTitle(book.snapshot) };
        await this.store.save(next);
        if (next.id === this.current?.id) this.current = next;
    }
}
