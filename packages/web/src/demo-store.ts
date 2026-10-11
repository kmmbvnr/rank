import { HISTORY_PAGE_SIZE, type NotebookStore, type SavedNotebook } from './notebook-store.js';

/** The website demo keeps its notebooks in memory, so it never reads or writes the console's storage. */
export function memoryNotebookStore(): NotebookStore {
    const books = new Map<string, SavedNotebook>();
    return {
        async get(id) { return books.get(id); },
        async save(book) { books.set(book.id, book); },
        async remove(id) { books.delete(id); },
        async list(before) {
            const items = [...books.values()]
                .sort((a, b) => b.updated - a.updated || (a.id < b.id ? 1 : -1))
                .filter(book => !before || book.updated < before.updated || book.updated === before.updated && book.id < before.id);
            const page = items.slice(0, HISTORY_PAGE_SIZE);
            const last = page.at(-1);
            return {
                items: page.map(({ snapshot: _snapshot, ...meta }) => meta),
                ...(items.length > page.length && last ? { next: { updated: last.updated, id: last.id } } : {}),
            };
        },
    };
}
