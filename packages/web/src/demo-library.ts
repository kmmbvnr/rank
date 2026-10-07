import { Capacitor, CapacitorHttp } from '@capacitor/core';

interface TreeEntry { path: string; type: string }
interface DemoTree { sha: string; tree: TreeEntry[]; truncated: boolean }
export interface LibraryEntry { path: string; name: string; directory: boolean }
const repository = 'https://api.github.com/repos/kmmbvnr/rank';
const raw = 'https://raw.githubusercontent.com/kmmbvnr/rank';

async function request(url: string, json = false): Promise<string> {
    const response = Capacitor.getPlatform() === 'android'
        ? await CapacitorHttp.get({ url, responseType: 'text', connectTimeout: 15000, readTimeout: 15000,
            headers: json ? { Accept: 'application/vnd.github+json' } : {} })
        : await fetch(url);
    if (response.status !== 200) throw new Error(response.status === 403 || response.status === 429
        ? 'GitHub request limit reached. Try again later.' : `Cannot load Library (HTTP ${response.status}).`);
    return response instanceof Response ? response.text()
        : typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
}
export function folderLabels(source: string, parent: string): Map<string, string> {
    const labels = new Map<string, string>();
    // Only local folder links supply labels; source links and prose remain GitHub content.
    for (const match of source.matchAll(/(?<!!)\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        try {
            const url = new URL(match[2], `https://library.invalid/${parent}/`);
            if (url.origin !== 'https://library.invalid') continue;
            const path = decodeURIComponent(url.pathname).replace(/^\/|\/$/g, '');
            const label = match[1].replace(/[*_`]/g, '').trim();
            if (label) labels.set(path, label);
        } catch { /* Ignore links that are not valid paths. */ }
    }
    return labels;
}
export async function libraryNotebookId(path: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`kmmbvnr/rank/${path}`));
    const hex = Array.from(new Uint8Array(digest)).slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export class DemoLibrary {
    private tree?: Promise<DemoTree>;
    private index(): Promise<DemoTree> {
        return this.tree ??= request(`${repository}/commits/main`, true).then(async text => {
            const { sha } = JSON.parse(text) as { sha: string };
            const tree = JSON.parse(await request(`${repository}/git/trees/${sha}?recursive=1`, true)) as DemoTree;
            if (!Array.isArray(tree.tree) || tree.truncated) throw new Error('GitHub Library listing is incomplete.');
            return { ...tree, sha };
        }).catch(error => { this.tree = undefined; throw error; });
    }
    async source(path: string): Promise<string> {
        const tree = await this.index();
        return request(`${raw}/${tree.sha}/${path.split('/').map(encodeURIComponent).join('/')}`);
    }
    async list(path: string): Promise<LibraryEntry[]> {
        const tree = await this.index();
        const entries = tree.tree.filter(entry => entry.path.startsWith(path + '/')
            && !entry.path.slice(path.length + 1).includes('/')
            && (entry.type === 'tree' || entry.type === 'blob' && entry.path.endsWith('.ra') && !entry.path.endsWith('_test.ra')));
        const readme = tree.tree.find(file => file.type === 'blob' && file.path.toLowerCase() === `${path}/readme.md`.toLowerCase());
        const labels = readme ? folderLabels(await this.source(readme.path), path) : new Map<string, string>();
        return entries.sort((a, b) => Number(b.type === 'tree') - Number(a.type === 'tree') || a.path.localeCompare(b.path))
            .map(entry => ({ path: entry.path, directory: entry.type === 'tree',
                name: entry.type === 'tree' ? labels.get(entry.path) || entry.path.slice(path.length + 1) : entry.path.slice(path.length + 1) }));
    }
}

/** Replaces notebook history with one Library directory at a time. */
export class LibraryBrowser {
    private readonly home: HTMLElement;
    private readonly view = document.createElement('div');
    private readonly back = document.createElement('button');
    private readonly status = document.createElement('p');
    private readonly list = document.createElement('div');
    private path = 'demos';
    private generation = 0;
    private opening = false;
    private readonly library = new DemoLibrary();
    constructor(menu: HTMLElement, private readonly open: (path: string, source: () => Promise<string>) => Promise<void>,
        private readonly close: () => void) {
        this.home = menu.querySelector<HTMLElement>('.library-home')!;
        this.view.className = 'library-view';
        this.view.hidden = true;
        this.view.setAttribute('aria-label', 'Library');
        this.back.type = 'button';
        this.back.className = 'library-back';
        this.back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg><span>Back</span>';
        this.back.onclick = () => {
            if (this.opening) return;
            if (this.path === 'demos') this.reset();
            else void this.show(this.path.slice(0, this.path.lastIndexOf('/')));
        };
        this.status.setAttribute('role', 'status');
        this.view.append(this.back, this.status, this.list);
        menu.append(this.view);
        this.home.querySelector<HTMLButtonElement>('[data-action="library"]')!.onclick = () => void this.show('demos');
    }
    reset(): void {
        this.generation++;
        this.view.hidden = true;
        this.home.hidden = false;
    }
    private async show(path: string): Promise<void> {
        const generation = ++this.generation;
        this.path = path;
        this.home.hidden = true;
        this.view.hidden = false;
        this.list.replaceChildren();
        this.status.textContent = 'Loading Library…';
        try {
            const entries = await this.library.list(path);
            if (generation !== this.generation) return;
            this.status.textContent = entries.length ? '' : 'No examples in this folder.';
            for (const entry of entries) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = entry.name + (entry.directory ? ' ›' : '');
                button.onclick = async () => {
                    if (this.opening) return;
                    if (entry.directory) { void this.show(entry.path); return; }
                    this.opening = true;
                    this.back.disabled = true;
                    this.status.textContent = 'Opening example…';
                    try { await this.open(entry.path, () => this.library.source(entry.path)); this.close(); }
                    catch (error) { if (generation === this.generation) this.status.textContent = String(error instanceof Error ? error.message : error); }
                    finally { this.opening = false; this.back.disabled = false; }
                };
                this.list.append(button);
            }
        } catch (error) {
            if (generation !== this.generation) return;
            this.status.textContent = error instanceof Error ? error.message : String(error);
            const retry = document.createElement('button');
            retry.textContent = 'Retry';
            retry.onclick = () => void this.show(path);
            this.list.append(retry);
        }
    }
}
