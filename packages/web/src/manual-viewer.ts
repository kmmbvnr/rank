import { keyManual } from './key-manual.js';

/** A separate modal leaves the notebook, cursor and keyboard layout intact. */
export class ManualViewer {
    private readonly dialog = document.createElement('dialog');
    private readonly body = document.createElement('div');
    private readonly title = document.createElement('h2');
    private origin?: HTMLElement;

    constructor() {
        this.dialog.id = 'key-manual';
        this.dialog.setAttribute('aria-labelledby', 'key-manual-title');
        this.title.id = 'key-manual-title';
        const header = document.createElement('header');
        const basics = document.createElement('button');
        basics.type = 'button';
        basics.textContent = 'Rank basics';
        basics.onclick = () => this.open('rank-basics', 'core', this.origin!);
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.setAttribute('aria-label', 'Close manual');
        close.onclick = () => this.dialog.close();
        header.append(this.title, basics, close);
        this.body.className = 'manual-body';
        this.dialog.append(header, this.body);
        document.body.append(this.dialog);
        this.dialog.addEventListener('click', event => {
            const rect = this.dialog.getBoundingClientRect();
            if (event.target === this.dialog && (event.clientX < rect.left || event.clientX > rect.right
                || event.clientY < rect.top || event.clientY > rect.bottom)) this.dialog.close();
        });
        this.dialog.addEventListener('close', () => this.origin?.focus({ preventScroll: true }));
    }

    open(key: string, module: string, origin: HTMLElement): void {
        const entry = keyManual(key, module);
        this.origin = origin;
        this.title.textContent = key === 'rank-basics' ? 'RANK(7)' : `${key.toUpperCase()}(1)`;
        this.body.replaceChildren();
        const section = (name: string, text: string) => {
            const heading = document.createElement('h3');
            heading.textContent = name;
            const content = document.createElement(name === 'SYNOPSIS' ? 'pre' : 'p');
            content.textContent = text;
            this.body.append(heading, content);
        };
        section('NAME', `${key === 'rank-basics' ? 'rank' : entry.name} — ${entry.summary}`);
        section('SYNOPSIS', entry.synopsis);
        section('DESCRIPTION', entry.description);
        section('EXAMPLES', '');
        for (const example of entry.examples) {
            const explanation = document.createElement('p');
            explanation.textContent = example.explanation;
            this.body.append(explanation);
            const code = document.createElement('pre');
            code.textContent = example.code;
            const copy = document.createElement('button');
            copy.type = 'button';
            copy.textContent = 'Copy';
            copy.setAttribute('aria-label', 'Copy example');
            copy.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(example.code);
                    copy.textContent = 'Copied';
                } catch {
                    copy.textContent = 'Copy failed — select the code';
                }
            };
            this.body.append(code, copy);
        }
        if (!this.dialog.open) this.dialog.showModal();
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
