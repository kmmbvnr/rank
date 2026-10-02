import { keyManual } from './key-manual.js';

const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
const backIcon = icon('M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z');
const closeIcon = icon('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z');
const copyIcon = icon('M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z');
const doneIcon = icon('M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');

function iconButton(svg: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'manual-icon';
    button.innerHTML = svg;
    button.setAttribute('aria-label', label);
    return button;
}

/** A paragraph whose `backticked` spans render as code. */
function prose(text: string, className?: string): HTMLParagraphElement {
    const paragraph = document.createElement('p');
    if (className) paragraph.className = className;
    text.split('`').forEach((part, i) => {
        if (i % 2 === 0) return paragraph.append(part);
        const code = document.createElement('code');
        code.textContent = part;
        paragraph.append(code);
    });
    return paragraph;
}

function codeBlock(text: string, className = 'manual-code'): HTMLPreElement {
    const pre = document.createElement('pre');
    pre.className = className;
    pre.textContent = text;
    return pre;
}

/**
 * A bottom sheet in the keyboard's own palette, like the module picker. As a
 * separate modal it leaves the notebook, cursor and keyboard layout intact.
 */
export class ManualViewer {
    private readonly dialog = document.createElement('dialog');
    private readonly body = document.createElement('div');
    private readonly title = document.createElement('h2');
    private readonly summary = document.createElement('p');
    private readonly module = document.createElement('span');
    private readonly back = iconButton(backIcon, 'Back');
    /** Pages left through See also, for the back button. */
    private history: string[] = [];
    private current = '';
    private origin?: HTMLElement;

    constructor() {
        this.dialog.id = 'key-manual';
        this.dialog.setAttribute('aria-labelledby', 'key-manual-title');
        this.dialog.setAttribute('aria-describedby', 'key-manual-summary');
        this.title.id = 'key-manual-title';
        this.summary.id = 'key-manual-summary';
        this.module.className = 'manual-module';
        const name = document.createElement('div');
        name.className = 'manual-name';
        name.append(this.title, this.module);
        this.back.onclick = () => this.show(this.history.pop()!);
        const close = iconButton(closeIcon, 'Close manual');
        close.onclick = () => this.dialog.close();
        const header = document.createElement('header');
        // The summary spans the whole width, so the back arrow never indents it.
        header.append(this.back, name, close, this.summary);
        this.body.className = 'manual-body';
        // Focus the text, not the close button, so opening shows no focus ring.
        this.body.tabIndex = -1;
        this.body.autofocus = true;
        this.dialog.append(header, this.body);
        document.body.append(this.dialog);
        this.dialog.addEventListener('click', event => {
            const rect = this.dialog.getBoundingClientRect();
            if (event.target === this.dialog && (event.clientX < rect.left || event.clientX > rect.right
                || event.clientY < rect.top || event.clientY > rect.bottom)) this.dialog.close();
        });
        // Escape (and Android back) steps back through followed links before closing.
        this.dialog.addEventListener('cancel', event => {
            if (!this.history.length) return;
            event.preventDefault();
            this.show(this.history.pop()!);
        });
        this.dialog.addEventListener('close', () => this.origin?.focus({ preventScroll: true }));
    }

    open(key: string, origin: HTMLElement): void {
        this.origin = origin;
        this.history = [];
        this.show(key);
        if (!this.dialog.open) this.dialog.showModal();
    }

    private follow(key: string): void {
        this.history.push(this.current);
        this.show(key);
    }

    private show(key: string): void {
        const entry = keyManual(key);
        const basics = key === 'rank-basics';
        this.current = key;
        this.back.hidden = !this.history.length;
        this.title.textContent = basics ? 'Rank basics' : entry.name;
        this.title.classList.toggle('code', !basics);
        this.module.textContent = basics ? '' : entry.module;
        this.summary.replaceChildren(...prose(entry.summary).childNodes);
        this.body.replaceChildren();
        const heading = (text: string) => {
            const element = document.createElement('h3');
            element.textContent = text;
            this.body.append(element);
        };
        if (entry.caption) this.body.append(prose(entry.caption));
        const card = document.createElement('div');
        card.className = 'manual-example';
        const copy = iconButton(copyIcon, 'Copy example');
        copy.onclick = async () => {
            try {
                await navigator.clipboard.writeText(entry.example);
                copy.innerHTML = doneIcon;
                copy.setAttribute('aria-label', 'Copied');
            } catch {
                copy.classList.add('failed');
                if (!card.nextElementSibling?.classList.contains('manual-hint'))
                    card.after(prose('Copy failed — select the code instead.', 'manual-hint'));
            }
        };
        card.append(codeBlock(entry.example), copy);
        if (entry.result) card.append(codeBlock(entry.result, 'manual-code manual-result'));
        this.body.append(card);
        for (const section of entry.sections) {
            heading(section.heading);
            if (section.code) this.body.append(codeBlock(section.code));
            for (const text of section.paragraphs) this.body.append(prose(text));
        }
        const links = entry.seeAlso;
        if (links.length) {
            heading('See also');
            const list = document.createElement('div');
            list.className = 'manual-links';
            for (const name of links) {
                const link = document.createElement('button');
                link.type = 'button';
                link.className = name === 'rank-basics' ? 'manual-link' : 'manual-link code';
                link.textContent = name === 'rank-basics' ? 'Rank basics' : name;
                link.onclick = () => this.follow(name);
                list.append(link);
            }
            this.body.append(list);
        }
        this.body.scrollTop = 0;
    }
}

/** Cancel a hold on scrolling or cancellation; consume its following compatibility click. */
export function manualKey(button: HTMLButtonElement, open: () => void, insert: () => void): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let held = false;
    let x = 0;
    let y = 0;
    const cancel = () => { clearTimeout(timer); timer = undefined; };
    button.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return;
        cancel();
        held = false;
        x = event.clientX;
        y = event.clientY;
        button.setPointerCapture(event.pointerId);
        timer = setTimeout(() => { cancel(); held = true; open(); }, 500);
    });
    button.addEventListener('pointermove', event => {
        if (timer && Math.hypot(event.clientX - x, event.clientY - y) > 10) { held = true; cancel(); }
    });
    for (const name of ['pointerup', 'lostpointercapture']) button.addEventListener(name, cancel);
    button.addEventListener('pointercancel', () => { held = true; cancel(); });
    button.addEventListener('contextmenu', event => event.preventDefault());
    button.onclick = event => {
        if (held) { event.preventDefault(); held = false; return; }
        if (button.getAttribute('aria-disabled') !== 'true') insert();
    };
}
