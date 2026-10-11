import { appEnvironment } from './notebook-store.js';

export class Feedback {
    private readonly dialog = document.createElement('dialog');
    private readonly description: HTMLTextAreaElement;
    private readonly diagnostics: HTMLElement;
    private readonly link: HTMLAnchorElement;

    constructor() {
        this.dialog.id = 'feedback';
        this.dialog.setAttribute('aria-labelledby', 'feedback-title');
        this.dialog.innerHTML = `<h2 id="feedback-title">Send feedback</h2>
            <label for="feedback-description">What happened? What did you expect?</label>
            <textarea id="feedback-description" rows="5"></textarea>
            <p>These app and device details will be included. Notebook contents are not included.</p>
            <pre></pre><p>Review and submit your report on GitHub. A GitHub account is required.</p>
            <div class="feedback-actions"><button type="button">Cancel</button><a target="_blank" rel="noopener noreferrer">Open GitHub</a></div>`;
        this.description = this.dialog.querySelector('textarea')!;
        this.diagnostics = this.dialog.querySelector('pre')!;
        this.link = this.dialog.querySelector('a')!;
        this.dialog.querySelector('button')!.onclick = () => this.dialog.close();
        this.description.oninput = () => this.updateLink();
        this.dialog.addEventListener('close', () => document.querySelector<HTMLButtonElement>('#menu-toggle')?.focus({ preventScroll: true }));
        document.body.append(this.dialog);
    }

    async open(): Promise<void> {
        this.diagnostics.textContent = 'Loading app details…';
        this.link.removeAttribute('href');
        if (!this.dialog.open) this.dialog.showModal();
        let environment: string[];
        try { environment = await appEnvironment(); }
        catch { environment = ['App details unavailable']; }
        this.diagnostics.textContent = [...environment, `Revision: ${import.meta.env.VITE_RANK_REVISION}`,
            `WebView/browser: ${navigator.userAgent}`].join('\n');
        this.updateLink();
    }

    back(): boolean {
        if (!this.dialog.open) return false;
        this.dialog.close();
        return true;
    }

    private updateLink(): void {
        if (this.diagnostics.textContent === 'Loading app details…') return;
        const url = new URL('https://github.com/kmmbvnr/rank/issues/new');
        url.searchParams.set('body', `## What happened\n\n${this.description.value}\n\n## Environment\n\n\`\`\`text\n${this.diagnostics.textContent}\n\`\`\``);
        this.link.href = url.href;
    }
}
