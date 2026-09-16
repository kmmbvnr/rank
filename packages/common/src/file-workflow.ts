import { Notebook, splitSource } from './notebook.js';
import type { ProgramFile } from './repl-session.js';
import type { ReplSession } from './repl-types.js';

export interface SavePrompt {
    choosing: boolean;
    exitAfterSave: boolean;
    loadFile?: ProgramFile;
    filename: Notebook;
    error: string;
}

/** Owns file identity, dirty checks, load transitions, and the save dialog. */
export class FileWorkflow {
    prompt?: SavePrompt;
    private preparation: Promise<void> = Promise.resolve();

    constructor(
        private readonly notebook: Notebook,
        private readonly session: ReplSession,
        private readonly breakpoints: Map<number, Set<number>>,
        private readonly prepareFunctions: (start?: number) => Promise<void>,
        private readonly clearDocumentState: () => void,
        private readonly running: () => boolean,
        private readonly setRunning: (running: boolean) => void,
        private readonly render: () => void,
    ) {}

    get ready(): Promise<void> { return this.preparation; }

    get unsaved(): boolean {
        const lines = this.saveLines();
        const source = lines.join('\n') + (lines.length ? '\n' : '');
        return source !== (this.session.savedFile?.source ?? '');
    }

    get status(): string {
        const file = this.session.savedFile;
        return `${file ? file.path.split(/[\\/]/).at(-1) : 'Untitled'} · ${this.unsaved ? 'unsaved' : 'saved'}`;
    }

    requestExit(): boolean {
        if (!this.unsaved) return true;
        this.openSavePrompt(true);
        return false;
    }

    async requestSave(): Promise<void> {
        if (this.running() || this.prompt) return;
        this.openSavePrompt(false);
        if (this.session.savedFile) await this.savePromptFile();
    }

    offerLoadedFile(file: ProgramFile): void {
        if (this.unsaved) this.openSavePrompt(false, file);
        else this.openFile(file);
    }

    discardChanges(): boolean {
        const prompt = this.prompt;
        if (!prompt) return false;
        if (prompt.loadFile) this.openFile(prompt.loadFile);
        this.prompt = undefined;
        this.render();
        return prompt.exitAfterSave;
    }

    async savePromptFile(): Promise<boolean> {
        const prompt = this.prompt;
        if (!prompt || this.running()) return false;
        this.setRunning(true);
        this.render();
        try {
            const result = await this.session.saveFile(this.saveLines(), prompt.filename.current.source);
            if (result.ok) {
                if (prompt.loadFile?.path === this.session.savedFile?.path) prompt.loadFile = this.session.savedFile;
                return this.discardChanges();
            }
            prompt.error = result.output.filter(line => line.error).map(line => line.text).join('\n');
            return false;
        } finally {
            this.setRunning(false);
            this.render();
        }
    }

    private saveLines(): string[] {
        const lines = this.notebook.fileLines();
        const draft = this.notebook.cells.at(-1)!.source;
        if (draft !== '' && !this.session.isCommand(draft.trim())) lines.push(...draft.split('\n'));
        return lines;
    }

    private openSavePrompt(exitAfterSave: boolean, loadFile?: ProgramFile): void {
        const filename = new Notebook();
        filename.replace(this.session.savedFile?.path ?? '');
        this.prompt = { choosing: exitAfterSave || !!loadFile, exitAfterSave, loadFile, filename, error: '' };
        this.render();
    }

    private openFile(file: ProgramFile): void {
        this.session.replaceFile(file);
        this.notebook.clear();
        this.breakpoints.clear();
        this.clearDocumentState();
        for (const source of splitSource(file.source)) this.notebook.enqueue(source, true);
        this.preparation = this.prepareFunctions();
    }
}
