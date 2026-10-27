import type { NotebookDraft, RamDocument } from './notebook-store.js';

const template = 'use ml\noption X .f16 shape 1 64\nreturn X relu\n';

/** Module documents belong to one notebook; the main REPL remains mounted. */
export class RamTabs {
    private modules: RamDocument[] = [];
    private active?: string;
    private readonly tabs = document.createElement('nav');
    private readonly panel = document.createElement('section');
    private readonly text = document.createElement('textarea');
    private readonly create = document.createElement('dialog');
    private readonly name = document.createElement('input');
    private readonly error = document.createElement('p');
    private readonly status = document.createElement('p');
    private opening = false;
    private borrowedKeyboard = false;
    constructor(private readonly changed: () => void, private readonly canSwitch: () => boolean,
        private readonly main: () => void,
        private readonly dialogKeyboard?: { open(): void | Promise<void>; close(created: boolean): void },
        private readonly created?: (name: string) => void) {
        this.tabs.id = 'source-tabs'; this.tabs.setAttribute('aria-label', 'Program sources');
        this.panel.id = 'ram-editor'; this.panel.hidden = true;
        this.text.setAttribute('aria-label', 'RAM module source');
        this.text.spellcheck = false; this.text.autocapitalize = 'off'; this.text.autocomplete = 'off';
        this.text.addEventListener('input', () => { this.capture(); this.changed(); });
        for (const event of ['select', 'scroll', 'blur']) this.text.addEventListener(event, () => { this.capture(); this.changed(); });
        const hint = document.createElement('p'); hint.textContent = 'Called from Program with use "hello.ram"';
        this.status.setAttribute('role', 'alert'); this.status.hidden = true;
        this.panel.append(hint, this.status, this.text);
        this.create.setAttribute('aria-label', 'Add RAM module');
        this.create.addEventListener('close', () => this.returnKeyboard(this.create.returnValue === 'created'));
        this.create.addEventListener('cancel', event => { event.preventDefault(); this.closeCreate(); });
        const form = document.createElement('form');
        const label = document.createElement('label'); label.textContent = 'Module name';
        this.name.name = 'module'; this.name.placeholder = 'hello'; this.name.required = true;
        this.name.autocapitalize = 'off'; this.name.autocomplete = 'off'; this.name.spellcheck = false;
        label.append(this.name); this.error.setAttribute('role', 'alert');
        const add = document.createElement('button'); add.textContent = 'Create'; add.type = 'submit';
        const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.type = 'button'; cancel.onclick = () => this.closeCreate();
        // Keep the text field focused until close restores the previous editor.
        // Focusing a button first makes Android dismiss and reopen the IME.
        cancel.addEventListener('pointerdown', event => event.preventDefault());
        cancel.addEventListener('mousedown', event => event.preventDefault());
        form.append(label, this.error, add, cancel); this.create.append(form);
        form.onsubmit = event => {
            event.preventDefault();
            const stem = this.name.value.trim().replace(/\.ram$/, '');
            if (!/^[a-z][a-z0-9_]*$/.test(stem)) { this.error.textContent = 'Use a lowercase name, digits or underscores.'; return; }
            const name = stem + '.ram';
            if (this.modules.some(module => module.name === name)) { this.error.textContent = 'That module already exists.'; return; }
            if (this.modules.length >= 64) { this.error.textContent = 'A program can contain at most 64 modules.'; return; }
            this.modules.push({ name, source: template });
            this.created?.(name); this.closeCreate(true); this.select(name);
        };
        document.body.append(this.tabs, this.panel, this.create); this.render();
    }
    private returnKeyboard(created: boolean): void {
        if (!this.borrowedKeyboard) return;
        this.borrowedKeyboard = false;
        this.dialogKeyboard?.close(created);
    }
    private closeCreate(created = false): void {
        this.create.close(created ? 'created' : '');
        // Restore the text connection inside the click, while it still carries
        // the user's activation. The later close event cannot keep Android's IME.
        this.returnKeyboard(created);
    }
    private capture(): void {
        const current = this.modules.find(module => module.name === this.active);
        if (current) Object.assign(current, { source: this.text.value, cursor: this.text.selectionStart, scroll: this.text.scrollTop });
    }
    snapshot(): Pick<NotebookDraft, 'modules' | 'activeModule'> {
        this.capture();
        return { ...(this.modules.length ? { modules: this.modules.map(module => ({ ...module })) } : {}),
            ...(this.active ? { activeModule: this.active } : {}) };
    }
    report(message: string): void { this.status.textContent = message; this.status.hidden = !message; }
    restore(snapshot: NotebookDraft): void {
        this.modules = (snapshot.modules ?? []).map(module => ({ ...module }));
        this.active = snapshot.activeModule; this.render();
    }
    private select(name?: string): void {
        if (!this.canSwitch()) return;
        this.capture(); this.active = name; this.render(); this.changed();
        if (name) this.text.focus(); else this.main();
    }
    private render(): void {
        this.tabs.replaceChildren();
        for (const name of [undefined, ...this.modules.map(module => module.name)]) {
            const tab = document.createElement('button'); tab.type = 'button';
            tab.textContent = name ?? 'Program'; tab.setAttribute('aria-pressed', String(name === this.active));
            tab.onclick = () => this.select(name); this.tabs.append(tab);
        }
        const add = document.createElement('button'); add.type = 'button'; add.textContent = '+';
        add.addEventListener('pointerdown', event => event.preventDefault());
        add.addEventListener('mousedown', event => event.preventDefault());
        add.setAttribute('aria-label', 'Add RAM module'); add.onclick = async () => {
            if (this.opening || !this.canSwitch()) return;
            this.opening = true;
            try {
                this.create.returnValue = '';
                this.borrowedKeyboard = true;
                await this.dialogKeyboard?.open();
                if (!this.canSwitch()) { this.returnKeyboard(false); return; }
                this.name.value = ''; this.error.textContent = ''; this.create.showModal(); this.name.focus();
            } finally { this.opening = false; }
        };
        this.tabs.append(add);
        const current = this.modules.find(module => module.name === this.active);
        this.panel.hidden = !current; document.documentElement.classList.toggle('ram-editing', !!current);
        if (current) {
            this.text.value = current.source;
            this.text.setSelectionRange(current.cursor ?? 0, current.cursor ?? 0);
            this.text.scrollTop = current.scroll ?? 0;
        }
    }
}
