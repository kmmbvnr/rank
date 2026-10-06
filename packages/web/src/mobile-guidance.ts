/** Guidance uses real notebook/keyboard actions; it never takes editor focus. */
type Step = 'offer' | 'run' | 'keyboard' | 'commands' | 'letters' | 'notebooks' | 'done';
type Hint = 'hold' | 'modules';
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
    targets: { notebook: HTMLElement; play: HTMLElement; commands?: HTMLElement; letters: HTMLElement;
        brand: HTMLElement; modules?: HTMLElement };
}
const storageKey = 'rank-mobile-guidance-v1';
const steps: Step[] = ['offer', 'run', 'keyboard', 'commands', 'letters', 'notebooks', 'done'];

export class MobileGuidance {
    private saved: SavedGuidance = {};
    private readonly card = document.createElement('aside');
    private readonly spotlight = document.createElement('div');
    private readonly text = document.createElement('p');
    private readonly actions = document.createElement('div');
    private hint?: Hint;
    private shown = '';
    private boundary = 0;
    private nextBoundary = 0;
    private wasKeyboard = false;
    private editing = false;
    private timer?: ReturnType<typeof setTimeout>;

    constructor(private context: () => GuidanceContext, private insertExample: () => void, private dismissKeyboard: () => void) {
        try {
            const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
            if (data && typeof data === 'object') {
                if (steps.includes(data.step)) this.saved.step = data.step;
                this.saved.keyboardUses = data.keyboardUses === 2 ? 2 : data.keyboardUses === 1 ? 1 : 0;
                for (const key of ['hold', 'notebooks', 'modules', 'documentation', 'letters', 'executed'] as const)
                    this.saved[key] = data[key] === true;
            }
        } catch { /* An unavailable preference must not block the editor. */ }
        if (this.saved.step === 'done') this.nextBoundary = 1;
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
        document.addEventListener('pointerup', event => {
            if (this.card.contains(event.target as Node)) return;
            // Typing is not a quiet interaction boundary. A later deliberate tap is.
            if ((event.target as HTMLElement).closest('textarea, #keyboard-keys')) return;
            this.quietBoundary();
        });
        // Consume this gesture so the same tap cannot edit code or activate a toolbar action.
        let dismissTap = false;
        document.addEventListener('pointerdown', event => {
            dismissTap = false;
            if (this.card.hidden || this.hint || this.saved.step !== 'keyboard' || !this.context().softKeyboard
                || event.target instanceof HTMLTextAreaElement) return;
            dismissTap = true;
            event.preventDefault(); event.stopPropagation();
        }, true);
        document.addEventListener('pointerup', event => {
            if (!dismissTap) return;
            event.preventDefault(); event.stopPropagation();
            this.dismissKeyboard();
        }, true);
        for (const type of ['mousedown', 'mouseup', 'click']) document.addEventListener(type, event => {
            if (!dismissTap) return;
            event.preventDefault(); event.stopPropagation();
            if (type === 'click') dismissTap = false;
        }, true);
        document.addEventListener('pointercancel', () => { dismissTap = false; }, true);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { clearTimeout(this.timer); this.hide(); }
            else this.update();
        });
        window.addEventListener('resize', () => this.update());
        window.visualViewport?.addEventListener('resize', () => this.update());
        window.visualViewport?.addEventListener('scroll', () => this.update());
    }

    private persist(): void {
        try { localStorage.setItem(storageKey, JSON.stringify(this.saved)); } catch { /* This session still remembers. */ }
    }
    private step(step: Step): void { this.saved.step = step; this.persist(); }
    private defer(): void { clearTimeout(this.timer); this.nextBoundary = this.boundary + 1; this.hide(); }
    private quietBoundary(): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.boundary++; this.editing = false; this.update(); }, 900);
    }
    edited(): void {
        clearTimeout(this.timer);
        this.editing = true;
        if (this.saved.step === 'offer') this.step('keyboard');
        this.hide();
    }
    discovered(action: 'hold' | 'notebooks' | 'modules' | 'documentation' | 'letters'): void {
        this.saved[action] = true;
        if (action === 'documentation' && this.saved.step === 'commands') this.step('letters');
        if (action === 'letters' && this.saved.step === 'letters') this.step('notebooks');
        if (action === 'notebooks' && this.saved.step === 'notebooks') { this.step('done'); this.defer(); }
        if (action === this.hint) { this.hint = undefined; this.defer(); }
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
        this.editing = false;
        this.nextBoundary = this.boundary;
        this.saved.documentation = this.saved.letters = this.saved.notebooks = false;
        this.step(this.context().empty ? 'offer' : 'keyboard');
        this.update();
    }
    private dismiss(): void {
        if (this.hint) { this.saved[this.hint] = true; this.hint = undefined; this.persist(); }
        this.defer();
    }
    private hide(): void { this.card.hidden = this.spotlight.hidden = true; }
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
        if (context.ready && context.rankKeyboard && !this.wasKeyboard && (this.saved.keyboardUses ?? 0) < 2) {
            this.saved.keyboardUses = (this.saved.keyboardUses ?? 0) + 1;
            this.persist();
        }
        this.wasKeyboard = context.rankKeyboard;
        if (!context.ready || context.unavailable || this.editing || document.hidden) { this.hide(); return; }
        if (!this.saved.step) this.step(context.empty ? 'offer' : 'keyboard');
        if (this.saved.step === 'offer' && !context.empty) { this.step('keyboard'); this.editing = true; this.hide(); return; }
        if (this.saved.step === 'keyboard' && context.rankKeyboard) this.step(this.saved.documentation ? 'letters' : 'commands');
        if (this.saved.step === 'letters' && this.saved.letters) this.step('notebooks');
        if (this.boundary < this.nextBoundary) { this.hide(); return; }
        const targets = context.targets;
        let target: HTMLElement | undefined;
        let text = '';
        let action: { label: string; run: () => void } | undefined;
        let guided = true;
        // Hold-to-run is a single, optional hint after successful execution.
        if (this.saved.executed && !this.saved.hold && context.codeLines >= 2 && this.visible(targets.play)
            && this.saved.step !== 'offer' && this.saved.step !== 'run') this.hint ??= 'hold';
        if (this.saved.step === 'done' && !this.hint) {
            if (!this.saved.modules && context.rankKeyboard && (this.saved.keyboardUses ?? 0) >= 2 && this.visible(targets.modules))
                this.hint = 'modules';
        }
        if (this.hint) {
            guided = false;
            if (this.hint === 'hold') { target = targets.play; text = 'Hold Play to run everything from the start.'; }
            if (this.hint === 'modules') { target = context.rankKeyboard ? targets.modules : undefined; text = 'Tap + to choose a module and add its commands to this keyboard.'; }
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
                    text = 'Hold a command on the Rank keyboard to open its documentation with an example.';
                }
                break;
            case 'notebooks': target = targets.brand; text = 'Tap RANK to open the floating panel with your saved notebooks.'; break;
            case 'letters':
                if (context.rankKeyboard) { target = targets.letters; text = 'Tap this keyboard button to return to the system keyboard.'; }
                break;
        }
        if (!this.visible(target)) { this.hide(); return; }
        const key = `${this.saved.step}:${this.hint ?? ''}`;
        if (this.shown !== key) {
            this.shown = key;
            this.text.textContent = text;
            this.text.hidden = !text;
            this.actions.replaceChildren();
            if (action) this.button(action.label, action.run);
            if (!guided) this.button('Got it', () => this.dismiss());
            this.actions.hidden = guided && !action;
        }
        this.card.dataset.step = this.hint ?? this.saved.step;
        this.card.classList.toggle('guided', guided);
        this.card.hidden = false;
        this.spotlight.hidden = !guided;
        this.position(target, guided);
    }
    private button(label: string, run: () => void): void {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = label;
        button.onclick = run;
        this.actions.append(button);
    }
    private position(target: HTMLElement, guided: boolean): void {
        const box = target.getBoundingClientRect();
        const viewport = window.visualViewport;
        const top = (viewport?.offsetTop ?? 0) + 8;
        const bottom = top + (viewport?.height ?? innerHeight) - 16;
        const width = Math.min(320, innerWidth - 24);
        this.card.style.width = width + 'px';
        const height = this.card.offsetHeight;
        let y = box.top - height - 14;
        if (y < top) y = box.bottom + 14;
        y = Math.max(top, Math.min(y, bottom - height));
        // A large notebook target reserves a readable card above the OS keyboard.
        if (target.id === 'terminal') y = Math.max(top, box.bottom - height - 12);
        this.card.style.left = Math.max(12, Math.min(box.left + box.width / 2 - width / 2, innerWidth - width - 12)) + 'px';
        this.card.style.top = y + 'px';
        if (guided) {
            Object.assign(this.spotlight.style, { left: box.left - 4 + 'px', top: box.top - 4 + 'px',
                width: box.width + 8 + 'px', height: box.height + 8 + 'px' });
        }
    }
}
