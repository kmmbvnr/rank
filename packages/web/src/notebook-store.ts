import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface RamDocument { name: string; source: string; cursor?: number; scroll?: number }
export interface NotebookDraft { cells: string[]; draft: string; modules?: RamDocument[]; attachments?: Record<string, string>; activeModule?: string }
export interface NotebookMeta {
    id: string;
    title: string;
    manual: boolean;
    created: number;
    updated: number;
}
export interface SavedNotebook extends NotebookMeta { snapshot: NotebookDraft }
export interface HistoryPage { items: NotebookMeta[]; next?: { updated: number; id: string } }
export interface NotebookStore {
    get(id: string): Promise<SavedNotebook | undefined>;
    save(book: SavedNotebook): Promise<void>;
    list(before?: HistoryPage['next']): Promise<HistoryPage>;
    remove(id: string): Promise<void>;
    exportFile?(id: string, archive?: { name: string; data: string }): Promise<void>;
    importFile?(): Promise<{ source?: string; archive?: string }>;
}
export const HISTORY_PAGE_SIZE = 25;
export function validDraft(value: unknown): value is NotebookDraft {
    const draft = value as NotebookDraft | undefined;
    return !!draft && Array.isArray(draft.cells) && draft.cells.every(cell => typeof cell === 'string')
        && (draft.attachments === undefined || validAttachments(draft.attachments))
        && typeof draft.draft === 'string' && (draft.modules === undefined || validRamDocuments(draft.modules))
        && (draft.activeModule === undefined || typeof draft.activeModule === 'string'
            && draft.modules?.some(module => module.name === draft.activeModule) === true);
}
/** Base64 is used only in persisted snapshots/worker messages, not each invocation. */
export function validAttachments(value: unknown): value is Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = Object.entries(value); let bytes = 0;
    return entries.length <= 64 && entries.every(([name, data]) => {
        if (!/^[a-z][a-z0-9_]*\.rwt$/.test(name) || typeof data !== 'string'
            || data.length > 5_594_000 || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return false;
        bytes += data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
        return bytes <= 8 * 1024 * 1024;
    });
}
export function validRamDocuments(value: unknown): value is RamDocument[] {
    return Array.isArray(value) && value.length <= 64 && value.every(module => module
        && typeof module.name === 'string' && /^[a-z][a-z0-9_]*\.ram$/.test(module.name)
        && typeof module.source === 'string' && module.source.length <= 1_048_576
        && (module.cursor === undefined || Number.isSafeInteger(module.cursor) && module.cursor >= 0 && module.cursor <= module.source.length)
        && (module.scroll === undefined || Number.isFinite(module.scroll) && module.scroll >= 0))
        && new Set(value.map(module => module.name)).size === value.length;
}
export function notebookSource(snapshot: NotebookDraft): string {
    return [...snapshot.cells, snapshot.draft].join('\n');
}
export function notebookTitle(snapshot: NotebookDraft): string {
    const lines = notebookSource(snapshot).split(/\r?\n/).map(line => line.trim())
        .filter(line => line && !/^use(?:\s|$)/.test(line));
    const comment = lines.find(line => /^rem(?:\s|$)/.test(line) && line.slice(3).trim());
    const title = (comment ? comment.slice(3) : lines[0] ?? '').trim().replace(/\s+/g, ' ') || 'New notebook';
    const chars = Array.from(title);
    return chars.length > 40 ? chars.slice(0, 39).join('') + '…' : title;
}

const native = registerPlugin<{
    environment(): Promise<{ debug: boolean; version: string; versionCode: number; android: string; device: string }>;
    get(options: { id: string; debugPreview?: boolean }): Promise<{ book?: SavedNotebook }>;
    save(options: { book: SavedNotebook; debugPreview?: boolean }): Promise<void>;
    list(options: { before?: HistoryPage['next']; limit: number; debugPreview?: boolean }): Promise<HistoryPage>;
    remove(options: { id: string; debugPreview?: boolean }): Promise<void>;
    exportFile(options: { id: string; debugPreview?: boolean; name?: string; data?: string }): Promise<void>;
    importFile(): Promise<{ source?: string; archive?: string }>;
    addListener(event: 'inputDownloadProgress', listener: (event: { id: string; received: number; total: number }) => void): Promise<PluginListenerHandle>;
    downloadInputFile(options: { id: string; url: string }): Promise<{ path: string; name: string }>;
    pickInputFile(): Promise<{ path?: string; name?: string }>;
}>('Notebooks');

export const pickInputFile = () => native.pickInputFile();
export async function downloadInputFile(url: string, progress: (received: number, total: number) => void): Promise<{ path: string; name: string }> {
    const id = crypto.randomUUID();
    const listener = await native.addListener('inputDownloadProgress', event => {
        if (event.id === id) progress(event.received, event.total);
    });
    try { return await native.downloadInputFile({ id, url }); }
    finally { await listener.remove(); }
}


/** Metadata and source use separate stores so paging never reads notebook bodies. */
export class BrowserNotebookStore implements NotebookStore {
    private readonly db: Promise<IDBDatabase>;
    constructor(name = 'rank-notebooks-v1') {
        this.db = new Promise((resolve, reject) => {
            const request = indexedDB.open(name, 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('meta', { keyPath: 'id' }).createIndex('recent', ['updated', 'id']);
                request.result.createObjectStore('source');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    async get(id: string): Promise<SavedNotebook | undefined> {
        const db = await this.db;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['meta', 'source']);
            const meta = tx.objectStore('meta').get(id);
            const source = tx.objectStore('source').get(id);
            tx.oncomplete = () => {
                if (meta.result && !validDraft(source.result)) reject(new Error('Notebook source is unavailable'));
                else resolve(meta.result ? { ...meta.result, snapshot: source.result } : undefined);
            };
            tx.onabort = () => reject(tx.error);
        });
    }
    async save({ snapshot, ...meta }: SavedNotebook): Promise<void> {
        const db = await this.db;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['meta', 'source'], 'readwrite');
            tx.objectStore('meta').put(meta);
            tx.objectStore('source').put(snapshot, meta.id);
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
        });
    }
    async remove(id: string): Promise<void> {
        const db = await this.db;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['meta', 'source'], 'readwrite');
            tx.objectStore('meta').delete(id);
            tx.objectStore('source').delete(id);
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
        });
    }
    async list(before?: HistoryPage['next']): Promise<HistoryPage> {
        const db = await this.db;
        return new Promise((resolve, reject) => {
            const tx = db.transaction('meta');
            const range = before ? IDBKeyRange.upperBound([before.updated, before.id], true) : undefined;
            const request = tx.objectStore('meta').index('recent').openCursor(range, 'prev');
            const items: NotebookMeta[] = [];
            let next: HistoryPage['next'];
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) return;
                if (items.length === HISTORY_PAGE_SIZE) {
                    const last = items.at(-1)!;
                    next = { id: last.id, updated: last.updated };
                } else { items.push(cursor.value); cursor.continue(); }
            };
            tx.oncomplete = () => resolve({ items, next });
            tx.onabort = () => reject(tx.error);
        });
    }
}

export async function debugNotebookMode(): Promise<boolean> {
    return Capacitor.getPlatform() === 'android' ? (await native.environment()).debug : import.meta.env.DEV;
}

export async function appVersion(): Promise<string> {
    if (Capacitor.getPlatform() !== 'android') return import.meta.env.VITE_RANK_VERSION;
    const info = await native.environment();
    return `${info.version} · build ${info.versionCode}`;
}

/** Explicitly requested diagnostics contain no notebook source or identifiers. */
export async function appEnvironment(): Promise<string[]> {
    if (Capacitor.getPlatform() !== 'android') return ['Platform: browser'];
    const info = await native.environment();
    return [`Rank: ${info.version} (${info.versionCode})`, `Build type: ${info.debug ? 'debug' : 'release'}`,
        `Android: ${info.android}`, `Device: ${info.device}`];
}

function createNotebookStore(debugPreview = false): NotebookStore {
    if (Capacitor.getPlatform() !== 'android') return new BrowserNotebookStore(debugPreview ? 'rank-beginner-notebooks-v1' : undefined);
    return {
        get: async id => (await native.get({ id, debugPreview })).book,
        save: book => native.save({ book, debugPreview }),
        list: before => native.list({ before, limit: HISTORY_PAGE_SIZE, debugPreview }),
        remove: id => native.remove({ id, debugPreview }),
        exportFile: (id, archive) => native.exportFile({ id, debugPreview, ...archive }),
        importFile: () => native.importFile(),
    };
}

/** Normal user history keeps its original database and file paths. */
export function notebookStore(): NotebookStore { return createNotebookStore(); }

/** Called only after the native debug-build check. Never a user profile. */
export function debugBeginnerStore(): NotebookStore { return createNotebookStore(true); }
