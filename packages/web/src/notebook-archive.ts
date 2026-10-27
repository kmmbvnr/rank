import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { notebookSource, validDraft, type NotebookDraft } from './notebook-store.js';

export function notebookArchive(snapshot: NotebookDraft): Uint8Array {
    const files: Record<string, Uint8Array> = { 'main.ra': strToU8(notebookSource(snapshot)),
        'rank-notebook.json': strToU8(JSON.stringify(snapshot)) };
    for (const module of snapshot.modules ?? []) files[module.name] = strToU8(module.source);
    return zipSync(files);
}
export function readNotebookArchive(data: Uint8Array): NotebookDraft {
    let total = 0, count = 0;
    const files = unzipSync(data, { filter: entry => {
        total += entry.originalSize; count++;
        if (total > 16 * 1024 * 1024 || count > 66) throw new Error('Program archive is too large');
        if (!/^(main\.ra|rank-notebook\.json|[a-z][a-z0-9_]*\.ram)$/.test(entry.name))
            throw new Error('Unexpected program archive entry: ' + entry.name);
        return true;
    } });
    if (!files['main.ra']) throw new Error('Program archive requires main.ra');
    const saved = files['rank-notebook.json'] ? JSON.parse(strFromU8(files['rank-notebook.json'])) as unknown : undefined;
    if (saved !== undefined && !validDraft(saved)) throw new Error('Invalid program snapshot');
    const snapshot: NotebookDraft = saved as NotebookDraft ?? { cells: [], draft: strFromU8(files['main.ra']) };
    // Plain source files are authoritative, including archives edited on desktop.
    if (notebookSource(snapshot) !== strFromU8(files['main.ra'])) {
        snapshot.cells = []; snapshot.draft = strFromU8(files['main.ra']);
    }
    const positions = new Map((snapshot.modules ?? []).map(module => [module.name, module]));
    snapshot.modules = Object.entries(files).filter(([name]) => name.endsWith('.ram'))
        .map(([name, data]) => ({ name, source: strFromU8(data), cursor: Math.min(positions.get(name)?.cursor ?? 0, strFromU8(data).length) }));
    if (!snapshot.modules.some(module => module.name === snapshot.activeModule)) delete snapshot.activeModule;
    if (!validDraft(snapshot)) throw new Error('Invalid program archive');
    return snapshot;
}
export function toBase64(data: Uint8Array): string {
    let result = '';
    for (let i = 0; i < data.length; i += 8192) result += String.fromCharCode(...data.subarray(i, i + 8192));
    return btoa(result);
}
export function fromBase64(data: string): Uint8Array { return Uint8Array.from(atob(data), character => character.charCodeAt(0)); }
