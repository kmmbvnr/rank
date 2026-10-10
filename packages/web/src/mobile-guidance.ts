/** During the walkthrough every activation performs the current scripted action. */
type Step = 'offer' | 'run' | 'keyboard' | 'commands' | 'letters' | 'autocomplete' | 'notebooks' | 'new-notebook' | 'done';
type Hint = 'hold';
interface SavedGuidance {
    step?: Step;
    hold?: boolean;
    notebooks?: boolean;
    modules?: boolean;
    documentation?: boolean;
    letters?: boolean;
    executed?: boolean;
    keyboardUses?: number;
}
export interface GuidanceContext {
    ready: boolean;
    empty: boolean;
    codeLines: number;
    unavailable: boolean;
    softKeyboard: boolean;
    rankKeyboard: boolean;
    notebookPanelOpen: boolean;
    targets: { notebook: HTMLElement; play: HTMLElement; commands?: HTMLElement; letters: HTMLElement;
        brand: HTMLElement; newNotebook?: HTMLElement; modules?: HTMLElement };
}
const storageKey = 'rank-mobile-guidance-v1';
const steps: Step[] = ['offer', 'run', 'keyboard', 'commands', 'letters', 'autocomplete', 'notebooks', 'new-notebook', 'done'];

export class MobileGuidance {
    private saved: SavedGuidance = {};
    private readonly card = document.createElement('aside');
    private readonly spotlight = document.createElement('div');
    private readonly text = document.createElement('p');
    private readonly actions = document.createElement('div');
    private hint?: Hint;
    private shown = '';
    private wasKeyboard = false;
    private routing = false;
    private suppressClickUntil = 0;
    private keyboardWasOpen = false;
    private keyboardRequested = false;
    private drawerRequested = false;
    private completionPrepared = false;
    private pointer?: { id: number; x: number; y: number; moved: boolean };

    constructor(private context: () => GuidanceContext, private insertExample: () => void, private dismissKeyboard: () => void,
        private showKeyboard: () => void, private autocomplete: (complete: boolean) => void, private readonly preferenceKey = storageKey) {
        try {
            const data = JSON.parse(localStorage.getItem(this.preferenceKey) || '{}');
            if (data && typeof data === 'object') {
                if (steps.includes(data.step)) this.saved.step = data.step;
                this.saved.keyboardUses = data.keyboardUses === 2 ? 2 : data.keyboardUses === 1 ? 1 : 0;
                for (const key of ['hold', 'notebooks', 'modules', 'documentation', 'letters', 'executed'] as const)
                    this.saved[key] = data[key] === true;
            }
        } catch { /* An unavailable preference must not block the editor. */ }
        this.card.id = 'mobile-guidance';
        this.card.setAttribute('aria-label', 'Rank walkthrough');
        this.card.setAttribute('aria-live', 'polite');
        this.spotlight.id = 'guidance-spotlight';
        this.spotlight.setAttribute('aria-hidden', 'true');
        this.card.append(this.text, this.actions);
        this.card.addEventListener('pointerdown', event => event.preventDefault());
        this.card.addEventListener('mousedown', event => event.preventDefault());
        document.body.append(this.spotlight, this.card);
        this.hide();
        const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
        document.addEventListener('pointerdown', event => {
            this.suppressClickUntil = 0;
            if (!this.active || this.routing) return;
            consume(event);
            if (event.isPrimary) this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        }, true);
        document.addEventListener('pointermove', event => {
            if (!this.active) return;
            if (this.pointer?.id === event.pointerId && Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) >= 12)
                this.pointer.moved = true;
            event.stopImmediatePropagation();
        }, true);
        document.addEventListener('pointerup', event => {
            if (!this.active || this.routing) return;
            consume(event);
            this.suppressClickUntil = Date.now() + 700;
            const pointer = this.pointer;
            this.pointer = undefined;
            if (pointer?.id === event.pointerId && (!pointer.moved || this.saved.step === 'autocomplete'
                && event.clientX - pointer.x >= 30 && event.clientX - pointer.x > 1.5 * Math.abs(event.clientY - pointer.y)))
                this.activate();
        }, true);
        document.addEventListener('click', event => {
            if (this.routing) return;
            // WebView may report a swipe's compatibility click with detail=0 too.
            if (Date.now() < this.suppressClickUntil) { consume(event); return; }
            if (!this.active) return;
            consume(event);
            this.activate();
        }, true);
        for (const type of ['mousedown', 'mouseup', 'contextmenu', 'beforeinput', 'paste', 'drop', 'selectstart', 'compositionstart'])
            document.addEventListener(type, event => { if (this.active && !this.routing) consume(event); }, true);
        document.addEventListener('pointercancel', () => { this.pointer = undefined; }, true);
        for (const type of ['touchstart', 'touchmove', 'touchend', 'wheel']) document.addEventListener(type, event => {
            if (this.active && !(event.target as Element).closest('#key-manual .manual-body')) consume(event);
        }, { capture: true, passive: false });
        document.addEventListener('keydown', event => {
            if (!this.active || this.routing) return;
            consume(event);
            if (!event.repeat && (['Enter', 'Escape'].includes(event.key)
                || event.key === ' ' && !(event.target instanceof HTMLTextAreaElement))) this.activate();
        }, true);
        document.addEventListener('cancel', event => {
            if (!this.active) return;
            consume(event);
            this.activate();
        }, true);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.hide();
            else this.update();
        });
        window.addEventListener('resize', () => this.update());
        window.visualViewport?.addEventListener('resize', () => this.update());
        window.visualViewport?.addEventListener('scroll', () => this.update());
    }

    private persist(): void {
        try { localStorage.setItem(this.preferenceKey, JSON.stringify(this.saved)); } catch { /* This session still remembers. */ }
    }
    private step(step: Step): void { this.saved.step = step; this.persist(); }
    get active(): boolean { return this.saved.step !== 'done'; }
    get commandLessonActive(): boolean { return this.active && this.saved.step === 'commands'; }
    back(): boolean { if (!this.active) return false; this.activate(); return true; }
    private activate(): void {
        if (!this.active || this.routing) return;
        const context = this.context();
        const closeManual = document.querySelector<HTMLButtonElement>('#key-manual[open] [aria-label="Close manual"]');
        if (!context.ready || context.unavailable && !closeManual) return;
        let target: HTMLElement | undefined;
        if (closeManual) target = closeManual;
        else if (this.hint === 'hold') target = context.targets.play;
        else switch (this.saved.step) {
            case 'offer': target = this.actions.querySelector<HTMLButtonElement>('button') ?? undefined; break;
            case 'run': target = context.targets.play; break;
            case 'keyboard': if (context.softKeyboard) this.dismissKeyboard(); return;
            case 'commands': target = context.targets.commands; break;
            case 'letters': target = context.targets.letters; break;
            case 'autocomplete':
                this.step('notebooks');
                this.autocomplete(true);
                return;
            case 'notebooks': target = context.targets.brand; break;
            case 'new-notebook': target = context.targets.newNotebook; break;
        }
        if (!this.visible(target)) return;
        this.routing = true;
        try { target.click(); } finally { this.routing = false; }
    }
    edited(): void {
        if (this.active) return;
        this.hide();
    }
    discovered(action: 'hold' | 'notebooks' | 'modules' | 'documentation' | 'letters' | 'newNotebook'): void {
        if (action !== 'newNotebook') this.saved[action] = true;
        if (action === 'documentation' && this.saved.step === 'commands') this.step('letters');
        if (action === 'letters' && this.saved.step === 'letters') this.step('autocomplete');
        if (action === 'notebooks' && this.saved.step === 'notebooks') this.step('new-notebook');
        if (action === 'newNotebook' && this.saved.step === 'new-notebook') this.step('done');
        if (action === this.hint) this.hint = undefined;
        this.persist();
        this.update();
    }
    executed(exampleCompleted: boolean): void {
        const context = this.context();
        if (context.codeLines < 2) return;
        this.saved.executed = true;
        if (this.saved.step === 'run' && exampleCompleted) this.step('keyboard');
        this.persist();
        this.update();
    }
    replay(): void {
        this.hint = undefined;
        this.saved.documentation = this.saved.letters = this.saved.notebooks = this.saved.hold = false;
        this.keyboardWasOpen = this.keyboardRequested = false;
        this.completionPrepared = false;
        this.step(this.context().empty ? 'offer' : 'keyboard');
        this.update();
    }
    private hide(): void { this.card.hidden = this.spotlight.hidden = true; }
    get holdHintVisible(): boolean { return this.hint === 'hold' && !this.card.hidden; }
    private visible(target?: HTMLElement): target is HTMLElement {
        if (!target || target.closest('[hidden]') || target.matches(':disabled, [aria-disabled="true"]')) return false;
        const rect = target.getBoundingClientRect();
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop ?? 0;
        const height = viewport?.height ?? innerHeight;
        return rect.width > 0 && rect.height > 0 && rect.top >= top && rect.bottom <= top + height
            && rect.left >= 0 && rect.right <= innerWidth;
    }

    update(): void {
        const context = this.context();
        // The final hint belongs inside the modal drawer's top layer.
        const parent = this.saved.step === 'new-notebook' && context.notebookPanelOpen
            ? context.targets.newNotebook?.closest('dialog') ?? document.body : document.body;
        if (this.card.parentElement !== parent) parent.append(this.spotlight, this.card);
        if (context.notebookPanelOpen && this.saved.step !== 'new-notebook') { this.hide(); return; }
        if (context.ready && context.rankKeyboard && !this.wasKeyboard && (this.saved.keyboardUses ?? 0) < 2) {
            this.saved.keyboardUses = (this.saved.keyboardUses ?? 0) + 1;
            this.persist();
        }
        this.wasKeyboard = context.rankKeyboard;
        if (!context.ready || context.unavailable || document.hidden) { this.hide(); return; }
        if (!this.saved.step) this.step(context.empty ? 'offer' : 'done');
        if (!this.active) { this.hide(); return; }
        if (this.saved.step === 'new-notebook' && !context.notebookPanelOpen) {
            this.hide();
            if (!this.drawerRequested) {
                this.drawerRequested = true;
                this.routing = true;
                try { context.targets.brand.click(); } finally { this.routing = false; }
            }
            return;
        }
        if (context.notebookPanelOpen) this.drawerRequested = false;
        // Older optional guidance could reach the keyboard step without a demonstrated run.
        if (this.saved.step === 'keyboard' && !this.saved.executed && !this.saved.hold) {
            this.saved.hold = true;
            this.persist();
        }
        if (this.saved.step === 'keyboard' && this.saved.hold) {
            if (context.softKeyboard) { this.keyboardWasOpen = true; this.keyboardRequested = false; }
            else if (this.keyboardWasOpen && context.rankKeyboard) this.step(this.saved.documentation ? 'letters' : 'commands');
            else {
                this.hide();
                if (!this.keyboardRequested) { this.keyboardRequested = true; this.showKeyboard(); }
                return;
            }
        }
        if (this.saved.step === 'letters' && this.saved.letters) this.step('autocomplete');
        if (this.saved.step === 'autocomplete' && !this.completionPrepared) {
            this.completionPrepared = true;
            this.autocomplete(false);
            return;
        }
        // Android may reopen the IME on resume. Restore the keyboard required by the saved step.
        if (this.saved.step === 'commands' || this.saved.step === 'letters') {
            if (context.softKeyboard) {
                this.hide();
                if (!this.keyboardRequested) { this.keyboardRequested = true; this.dismissKeyboard(); }
                return;
            }
            if (context.rankKeyboard) this.keyboardRequested = false;
        }
        const targets = context.targets;
        let target: HTMLElement | undefined;
        let text = '';
        let action: { label: string; run: () => void } | undefined;
        let guided = true;
        // Restart is part of the script and precedes the keyboard introduction.
        if (this.saved.step !== 'new-notebook' && this.saved.executed && !this.saved.hold && context.codeLines >= 2 && this.visible(targets.play)
            && this.saved.step !== 'offer' && this.saved.step !== 'run') this.hint ??= 'hold';
        if (this.hint) {
            guided = false;
            if (this.hint === 'hold') { target = targets.play; text = 'Tap and hold Play to run everything from the start.'; }
        } else switch (this.saved.step) {
            case 'offer':
                target = targets.notebook; text = 'Let’s get to know Rank with a short example.';
                action = { label: 'Start', run: () => {
                    if (!this.context().empty) { this.edited(); return; }
                    this.step('run'); this.insertExample(); this.update();
                } }; break;
            case 'run': target = targets.play; text = 'Tap Play to run through the selected line and multiply every number in the array by ten.'; break;
            case 'keyboard':
                // The system keyboard is owned by the OS. Point at the editor above it.
                if (context.softKeyboard) { target = targets.notebook; text = 'Dismiss the system keyboard with its hide key to reveal Rank commands.'; }
                break;
            case 'commands':
                if (context.rankKeyboard) {
                    target = targets.commands;
                    text = 'Tap and hold a command on the Rank keyboard to open its documentation with an example.';
                }
                break;
            case 'new-notebook':
                if (context.notebookPanelOpen) { target = targets.newNotebook; text = 'Start a new notebook and try your own ideas in Rank.'; }
                break;
            case 'notebooks': target = targets.brand; text = 'Tap RANK to open the floating panel with your saved notebooks.'; break;
            case 'autocomplete': target = targets.notebook; text = 'Swipe right across the editor to autocomplete arr to array.'; break;
            case 'letters':
                if (context.rankKeyboard) { target = targets.letters; text = 'Tap this keyboard button to return to the system keyboard.'; }
                break;
        }
        if (!this.visible(target)) { this.hide(); return; }
        const key = `${this.saved.step}:${this.hint ?? ''}`;
        if (this.shown !== key) {
            this.shown = key;
            this.text.textContent = text;
            const hideKey = 'hide key';
            const hideAt = text.indexOf(hideKey);
            if (hideAt >= 0) {
                const label = document.createElement('span');
                label.className = 'guidance-hide-key';
                const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                icon.setAttribute('viewBox', '0 0 24 24');
                icon.setAttribute('aria-hidden', 'true');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z');
                icon.append(path);
                label.append(hideKey, icon);
                this.text.replaceChildren(text.slice(0, hideAt), label, text.slice(hideAt + hideKey.length));
            }
            this.text.hidden = !text;
            this.actions.replaceChildren();
            if (action) this.button(action.label, action.run);
            this.actions.hidden = !action;
        }
        this.card.dataset.step = this.hint ?? this.saved.step;
        this.card.classList.toggle('guided', guided);
        this.card.hidden = false;
        const outlined = guided && target !== targets.notebook;
        this.spotlight.hidden = !outlined;
        this.position(target, outlined, targets.play);
    }
    private button(label: string, run: () => void): void {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = label;
        button.onclick = run;
        this.actions.append(button);
    }
    private position(target: HTMLElement, guided: boolean, play: HTMLElement): void {
        const box = target.getBoundingClientRect();
        const viewport = window.visualViewport;
        const viewportTop = viewport?.offsetTop ?? 0;
        const viewportBottom = viewportTop + (viewport?.height ?? innerHeight);
        const top = viewportTop + 8;
        const bottom = viewportBottom - 8;
        const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0;
        const cardTop = top + safeTop;
        const width = Math.min(320, innerWidth - 24);
        this.card.style.width = width + 'px';
        const height = this.card.offsetHeight;
        let y = box.top - height - 14;
        // Full-width text must stay below the camera cutout, including inside a modal drawer.
        if (y < cardTop) y = box.bottom + 14;
        y = Math.max(cardTop, Math.min(y, bottom - height));
        // Center editor-wide guidance in the space above Play, also when the IME shrinks the editor.
        if (target.id === 'terminal') {
            const contentBottom = this.visible(play) ? Math.min(box.bottom, play.getBoundingClientRect().top - 14) : box.bottom;
            y = Math.max(cardTop, Math.min((box.top + contentBottom - height) / 2, bottom - height));
        }
        this.card.style.left = Math.max(12, Math.min(box.left + box.width / 2 - width / 2, innerWidth - width - 12)) + 'px';
        this.card.style.top = y + 'px';
        if (guided) {
            // The logo's 44px touch target is taller than its text; highlight the text with equal padding.
            let outlineBox = box;
            if (target.id === 'brand') {
                const range = document.createRange();
                range.selectNodeContents(target);
                outlineBox = range.getBoundingClientRect();
            }
            // Use one inset on every side; independently clamping an edge squeezes the highlight against Play.
            const padding = Math.max(0, Math.min(4, outlineBox.left, innerWidth - outlineBox.right,
                outlineBox.top - viewportTop, viewportBottom - outlineBox.bottom));
            const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
            Object.assign(this.spotlight.style, { left: outlineBox.left - padding + 'px', top: outlineBox.top - padding + 'px',
                width: outlineBox.width + padding * 2 + 'px', height: outlineBox.height + padding * 2 + 'px',
                borderRadius: Math.max(12, radius + padding) + 'px' });
        }
    }
}
