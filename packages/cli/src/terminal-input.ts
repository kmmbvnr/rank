import { StringDecoder } from 'node:string_decoder';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/** Separates ordinary terminal keys from bracketed paste across arbitrary input chunks. */
export class TerminalInputDecoder {
    private readonly decoder = new StringDecoder('utf8');
    private pending = '';
    private paste: string | undefined;

    constructor(
        private readonly keys: (text: string) => void,
        private readonly pasted: (text: string) => void,
        private readonly clicked: (column: number, row: number) => void = () => {},
        private readonly scrolled: (direction: number) => void = () => {},
        private readonly dragged: (column: number, row: number, released: boolean) => void = () => {},
    ) {}

    write(chunk: Buffer): void {
        this.pending += this.decoder.write(chunk);
        this.drain();
    }

    end(): void {
        this.pending += this.decoder.end();
        if (this.paste === undefined) this.keys(this.pending);
        else this.pasted(this.paste + this.pending);
        this.pending = '';
        this.paste = undefined;
    }

    private drain(): void {
        for (;;) {
            const marker = this.paste === undefined ? PASTE_START : PASTE_END;
            const at = this.pending.indexOf(marker);
            if (this.paste === undefined) {
                const mouse = this.pending.indexOf('\x1b[<');
                if (mouse >= 0 && (at < 0 || mouse < at)) {
                    this.keys(this.pending.slice(0, mouse));
                    this.pending = this.pending.slice(mouse);
                    const report = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(this.pending);
                    if (report) {
                        this.pending = this.pending.slice(report[0].length);
                        if (report[1] === '0' && report[4] === 'M')
                            this.clicked(Number(report[2]) - 1, Number(report[3]) - 1);
                        if (report[1] === '32' && report[4] === 'M' || report[1] === '0' && report[4] === 'm')
                            this.dragged(Number(report[2]) - 1, Number(report[3]) - 1, report[4] === 'm');
                        if (report[4] === 'M' && (report[1] === '64' || report[1] === '65'))
                            this.scrolled(report[1] === '64' ? -1 : 1);
                        continue;
                    }
                    if (/^\x1b\[<[\d;]*$/.test(this.pending)) return;
                }
            }
            if (at >= 0) {
                const before = this.pending.slice(0, at);
                this.pending = this.pending.slice(at + marker.length);
                if (this.paste === undefined) {
                    this.keys(before);
                    this.paste = '';
                } else {
                    this.pasted(this.paste + before);
                    this.paste = undefined;
                }
                continue;
            }
            // Retain a split marker, but deliver an ordinary one-byte Esc immediately.
            let tail = 0;
            for (let size = 2; size < marker.length; size++) {
                if (this.pending.endsWith(marker.slice(0, size))) tail = size;
            }
            const ready = tail ? this.pending.slice(0, -tail) : this.pending;
            this.pending = tail ? this.pending.slice(-tail) : '';
            if (this.paste === undefined) this.keys(ready); else this.paste += ready;
            return;
        }
    }
}
