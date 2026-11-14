import { Capacitor } from '@capacitor/core';
import { parse } from '@arrrank/interpreter';
import { isArgStatement, isStringLiteral } from '@arrrank/language';
import { splitSource } from '@arrrank/common/notebook';
import { pickInputFile, downloadInputFile } from './notebook-store.js';
import type { BrowserFile, ProgramInputValue } from './protocol.js';

export interface ProgramInput {
    name: string;
    valueType: string;
    many: boolean;
    defaultSource?: string;
    defaultPath?: string;
}
interface SavedInput { valueType: string; many: boolean; values: string[]; fileNames?: string[] }

const declarations = new Map<string, ProgramInput[]>();

/** Read declarations without executing defaults or any of the user's program. */
export function programInputs(source: string): ProgramInput[] {
    const cached = declarations.get(source);
    if (cached) return cached;
    const inputs = splitSource(source).flatMap(cell => {
        try {
            return parse(cell).statements.flatMap<ProgramInput>(statement => {
                if (isArgStatement(statement) && statement.valueType) return [{
                    name: statement.name, valueType: statement.valueType, many: statement.many,
                    defaultSource: statement.defaultValue?.$cstNode?.text,
                    defaultPath: isStringLiteral(statement.defaultValue) ? statement.defaultValue.value : undefined,
                }];
                return [];
            });
        } catch { return []; } // Unfinished cells stay editable.
    });
    if (declarations.size > 128) declarations.clear();
    declarations.set(source, inputs);
    return inputs;
}

/** Keep the frequent screen repaint cheap for ordinary source lines. */
export function pathInput(source: string): ProgramInput | undefined {
    if (!/^\s*arg\s+\S+\s+path\b/.test(source)) return undefined;
    return programInputs(source).find(input => input.valueType === 'path');
}

function fileDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('rank-program-files', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}
export async function storeFile(path: string, file?: File): Promise<File | undefined> {
    const db = await fileDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('files', file ? 'readwrite' : 'readonly');
            const request = file ? tx.objectStore('files').put(file, path) : tx.objectStore('files').get(path);
            tx.oncomplete = () => resolve(file ?? request.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally { db.close(); }
}

/** The default as editable text: numbers and booleans as written, plain text literals unquoted. */
function prefill(input: ProgramInput): string | undefined {
    const source = input.defaultSource?.trim();
    if (source === undefined || input.many) return undefined;
    if (input.valueType === 'text' || input.valueType === 'path') {
        const literal = /^"([^"\\]*)"$/.exec(source);
        return literal ? literal[1] : undefined;
    }
    return /^[-\w.]+$/.test(source) ? source : undefined;
}

export class ProgramInputs {
    private key = '';
    private saved: Record<string, SavedInput> = {};
    private configured = '';
    private readonly statuses = new Map<string, string>();
    private readonly resolvedNames = new Map<string, string>();
    private readonly dialog = document.createElement('dialog');
    constructor(private readonly changed: () => void, private readonly run: () => Promise<void>,
        private readonly configure: (inputs: ProgramInputValue[], files: BrowserFile[]) => Promise<void>,
        private readonly report: (error: unknown) => void) {
        this.dialog.id = 'program-inputs';
        this.dialog.setAttribute('aria-label', 'Run program');
        document.body.append(this.dialog);
    }
    use(id: string): void {
        const key = 'rank-program-inputs-v1:' + id;
        if (key === this.key) return;
        this.key = key;
        this.statuses.clear(); this.resolvedNames.clear();
        this.saved = {};
        try {
            const data = JSON.parse(localStorage.getItem(key) ?? '{}');
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                for (const [name, value] of Object.entries(data)) {
                    const input = value as SavedInput;
                    if (input && typeof input.valueType === 'string' && typeof input.many === 'boolean'
                        && Array.isArray(input.values) && input.values.every(v => typeof v === 'string')
                        && (input.fileNames === undefined || Array.isArray(input.fileNames) && input.fileNames.every(v => typeof v === 'string')))
                        this.saved[name] = input;
                }
            }
        } catch { /* New settings can still be entered. */ }
    }
    private value(input: ProgramInput): SavedInput | undefined {
        const saved = this.saved[input.name];
        return saved?.valueType === input.valueType && saved.many === input.many ? saved : undefined;
    }
    private save(): void {
        localStorage.setItem(this.key, JSON.stringify(this.saved));
        this.changed();
    }
    async apply(source: string): Promise<boolean> {
        const declarations = programInputs(source);
        const values = declarations.flatMap(input => {
            const saved = this.value(input);
            if (saved) return [{ name: input.name, valueType: input.valueType, many: input.many, values: [...saved.values] }];
            if (input.valueType === 'path' && !input.many && input.defaultPath && /^https?:\/\//i.test(input.defaultPath))
                return [{ name: input.name, valueType: 'path', many: false, values: [input.defaultPath] }];
            return [];
        });
        const signature = JSON.stringify([this.key, values]);
        if (signature === this.configured) return false;
        if (!this.configured && !values.length) { this.configured = signature; return false; }
        const files: BrowserFile[] = [];
        for (const input of values.filter(input => input.valueType === 'path')) {
            const names: string[] = [];
            try {
                for (let index = 0; index < input.values.length; index++) {
                    let path = input.values[index];
                    if (/^https?:\/\//i.test(path)) {
                        const downloaded = await this.download(path, status => this.status(input.name, status));
                        path = downloaded.path; input.values[index] = path; names.push(downloaded.name);
                    }
                    if (Capacitor.getPlatform() === 'android' || !path.startsWith('inputs/')) continue;
                    const file = await storeFile(path);
                    if (!file) throw new Error('Please choose the file again: ' + input.name);
                    files.push({ name: path, data: await file.arrayBuffer() });
                }
                if (names.length) this.resolvedNames.set(input.name, names.join(', '));
                this.status(input.name);
            } catch (error) { this.status(input.name, String(error)); throw error; }
        }
        await this.configure(values, files);
        this.configured = signature;
        return true;
    }
    private status(name: string, status?: string): void {
        if (status === undefined) this.statuses.delete(name);
        else this.statuses.set(name, status);
        const label = status ?? this.resolvedNames.get(name) ?? this.saved[name]?.fileNames?.join(', ') ?? '';
        for (const element of this.dialog.querySelectorAll<HTMLElement>('[data-input-status]'))
            if (element.dataset.inputStatus === name) element.textContent = label;
        this.changed();
    }
    private async download(source: string, progress: (status: string) => void): Promise<{ path: string; name: string }> {
        const url = new URL(source); url.hash = '';
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Expected an HTTP or HTTPS URL');
        const name = decodeURIComponent(url.pathname.split('/').at(-1) || 'download');
        const report = (received: number, total: number) => {
            const unit = Math.min(3, Math.max(0, Math.floor(Math.log2(Math.max(1, total || received)) / 10)));
            const size = (bytes: number) => (bytes / 1024 ** unit).toFixed(unit ? 1 : 0);
            const amount = total > 0
                ? `${Math.min(100, Math.floor(received / total * 100))}% · ${size(received)} / ${size(total)}`
                : size(received);
            progress(`Downloading… ${amount} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`);
        };
        report(0, 0);
        if (Capacitor.getPlatform() === 'android') return downloadInputFile(url.href, report);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url.href))))
            .map(byte => byte.toString(16).padStart(2, '0')).join('');
        const path = 'inputs/url-' + hash;
        if (await storeFile(path)) return { path, name };
        // Project Euler does not expose CORS headers; its public documents
        // have a fixed upstream route on the web host.
        const target = url.origin === 'https://projecteuler.net'
            && /^\/resources\/documents\/[A-Za-z0-9_.-]+$/.test(url.pathname)
            ? '/__rank_euler/' + url.pathname.split('/').at(-1) : url.href;
        const response = await fetch(target);
        if (!response.ok) throw new Error(`Cannot download ${name}: HTTP ${response.status}`);
        const encoding = response.headers.get('Content-Encoding');
        const total = encoding && encoding !== 'identity' ? 0 : Number(response.headers.get('Content-Length')) || 0;
        report(0, total);
        const reader = response.body?.getReader();
        const chunks: ArrayBuffer[] = []; let received = 0, last = 0;
        if (reader) {
            try {
                for (;;) {
                    const { done, value } = await reader.read(); if (done) break;
                    chunks.push(value.slice().buffer); received += value.byteLength;
                    if (performance.now() - last >= 100) { report(received, total); last = performance.now(); }
                }
            } finally { reader.releaseLock(); }
        } else { const data = await response.arrayBuffer(); chunks.push(data); received = data.byteLength; }
        await storeFile(path, new File(chunks, name));
        report(received, received);
        return { path, name };
    }
    async clearRuntime(): Promise<void> {
        this.configured = '';
        await this.configure([], []);
    }
    filename(input: ProgramInput): string | undefined {
        return this.statuses.get(input.name) ?? this.resolvedNames.get(input.name) ?? this.value(input)?.fileNames?.join(', ');
    }
    async pick(input: ProgramInput): Promise<void> {
        if (Capacitor.getPlatform() === 'android') {
            const file = await pickInputFile();
            if (!file.path) return;
            this.saved[input.name] = { ...input, values: input.many
                ? [...(this.value(input)?.values ?? []), file.path] : [file.path], fileNames: input.many
                ? [...(this.value(input)?.fileNames ?? []), file.name ?? file.path] : [file.name ?? file.path] };
        } else {
            const picker = document.createElement('input');
            picker.type = 'file'; picker.multiple = input.many;
            const files = await new Promise<File[]>(resolve => {
                picker.onchange = () => resolve(Array.from(picker.files ?? []));
                picker.oncancel = () => resolve([]);
                picker.click();
            });
            if (!files.length) return;
            const paths = await Promise.all(files.map(async file => {
                const path = 'inputs/' + crypto.randomUUID() + '/' + file.name;
                await storeFile(path, file); return path;
            }));
            this.saved[input.name] = { ...input, values: paths, fileNames: files.map(file => file.name) };
        }
        this.statuses.delete(input.name); this.resolvedNames.delete(input.name);
        this.save();
    }
    decorate(row: HTMLElement, input: ProgramInput): void {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'path-file-picker';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('width', '20'); icon.setAttribute('height', '20');
        icon.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(icon.namespaceURI, 'path');
        path.setAttribute('d', 'M3 6h7l2 2h9v12H3z'); path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.5');
        icon.append(path); button.append(icon);
        button.setAttribute('aria-label', 'Choose file for ' + input.name);
        button.title = this.filename(input) ?? 'Choose file';
        button.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
        button.onclick = event => {
            event.stopPropagation();
            void this.pick(input).catch(this.report);
        };
        row.append(button);
    }
    back(): boolean {
        if (!this.dialog.open) return false;
        this.dialog.close(); return true;
    }
    open(source: string): void {
        const inputs = programInputs(source);
        if (!inputs.length) { void this.run().catch(this.report); return; }
        const form = document.createElement('form');
        const header = document.createElement('div'); header.className = 'program-input-header';
        const heading = document.createElement('h2'); heading.textContent = 'Run program';
        const run = document.createElement('button'); run.type = 'submit'; run.className = 'program-input-run';
        run.setAttribute('aria-label', 'Run'); run.title = 'Run';
        run.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>';
        header.append(heading, run); form.append(header);
        const readers: (() => void)[] = [];
        for (const input of inputs) {
            const row = document.createElement('label'); row.className = 'input-row';
            const name = document.createElement('span'); name.className = 'input-name'; name.textContent = input.name;
            const hint = document.createElement('small'); hint.className = 'input-help';
            hint.textContent = input.valueType + (input.many ? ' array' : '')
                + (input.defaultSource !== undefined && prefill(input) === undefined ? ' · default ' + input.defaultSource : '');
            const saved = this.value(input);
            // A default is the field's starting text, so running at once uses it.
            const start = prefill(input);
            const value = input.many ? document.createElement('textarea') : document.createElement('input');
            if (input.many) (value as HTMLTextAreaElement).rows = 2;
            value.setAttribute('aria-label', input.name);
            value.placeholder = input.many ? (input.defaultSource ?? 'One value per line')
                : input.defaultSource ?? (input.valueType === 'path' ? 'File path or URL' : 'Required');
            value.value = (saved?.fileNames ?? saved?.values)?.join(input.many ? '\n' : '') ?? (saved ? '' : start ?? '');
            value.required = input.defaultSource === undefined && input.valueType !== 'text';
            value.autocapitalize = 'off'; value.spellcheck = false;
            row.append(name, value, hint);
            if (input.valueType === 'path') {
                const choose = document.createElement('button'); choose.type = 'button'; choose.textContent = 'Choose file';
                const file = document.createElement('small'); file.dataset.inputStatus = input.name; file.textContent = this.filename(input) ?? '';
                choose.onclick = () => {
                    choose.disabled = true;
                    void this.pick(input).then(() => {
                        const selected = this.value(input);
                        if (!selected) return;
                        value.value = (selected.fileNames ?? selected.values).join(input.many ? '\n' : '');
                        file.textContent = this.filename(input) ?? '';
                    }).catch(this.report).finally(() => { choose.disabled = false; });
                };
                row.append(choose, file);
            }
            readers.push(() => {
                const unchanged = input.defaultSource !== undefined
                    && (value.value === '' && start === undefined || start !== undefined && value.value === start);
                if (unchanged) delete this.saved[input.name];
                else {
                    const selected = this.value(input);
                    const fileSelected = input.valueType === 'path' && selected?.fileNames?.join(input.many ? '\n' : '') === value.value;
                    const values = fileSelected ? selected!.values
                        : input.many ? value.value.split('\n').filter(v => v.length > 0) : [value.value];
                    this.saved[input.name] = { valueType: input.valueType, many: input.many, values,
                        fileNames: fileSelected ? selected!.fileNames : undefined };
                }
            });
            form.append(row);
        }
        const error = document.createElement('p'); error.setAttribute('role', 'alert');
        form.append(error);
        form.onsubmit = event => {
            event.preventDefault(); run.disabled = true;
            for (const field of form.querySelectorAll('input, textarea')) (field as HTMLInputElement).disabled = true;
            void (async () => {
                const previous = structuredClone(this.saved);
                try {
                    readers.forEach(read => read());
                    await this.apply(source);
                    if (!this.dialog.open) { this.saved = previous; return; }
                    this.save();
                } catch (error) { this.saved = previous; throw error; }
                this.dialog.close(); await this.run();
            })().catch(reason => { error.textContent = String(reason); }).finally(() => {
                run.disabled = false;
                for (const field of form.querySelectorAll('input, textarea')) (field as HTMLInputElement).disabled = false;
            });
        };
        // A tap outside the panel dismisses it.
        this.dialog.onclick = event => { if (event.target === this.dialog) this.dialog.close(); };
        this.dialog.replaceChildren(form); this.dialog.showModal();
        form.querySelector<HTMLElement>('input, textarea')?.focus();
    }
}
