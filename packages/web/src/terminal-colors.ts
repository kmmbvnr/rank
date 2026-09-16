/** Render the shared terminal's SGR spans without interpreting output as HTML. */
export function paintLine(row: HTMLElement, line: string): void {
    const colors: Record<number, string> = {
        30: '#000000', 31: '#cd3131', 32: '#0dbc79', 33: '#e5e510',
        34: '#2472c8', 35: '#bc3fbc', 36: '#11a8cd', 37: '#e5e5e5', 90: '#808080',
    };
    let color = '';
    let inverse = false;
    let offset = 0;
    function append(text: string): void {
        if (!text) return;
        const span = document.createElement('span');
        span.textContent = text;
        span.style.color = inverse ? '#000' : color;
        if (inverse) span.style.backgroundColor = color || '#e5e5e5';
        row.append(span);
    }
    for (const match of line.matchAll(/\x1b\[([0-9;]*)m/g)) {
        append(line.slice(offset, match.index));
        const codes = match[1].split(';').map(Number);
        for (let i = 0; i < codes.length; i++) {
            const code = codes[i];
            if (code === 0) { color = ''; inverse = false; }
            else if (code === 7) inverse = true;
            else if (code === 27) inverse = false;
            else if (code === 39) color = '';
            else if (code === 38 && codes[i + 1] === 5) {
                const index = codes[i + 2];
                if (index >= 16 && index <= 231) {
                    const channel = (n: number) => n === 0 ? 0 : 55 + n * 40;
                    const n = index - 16;
                    color = `rgb(${channel(Math.floor(n / 36))}, ${channel(Math.floor(n / 6) % 6)}, ${channel(n % 6)})`;
                }
                i += 2;
            } else if (colors[code]) color = colors[code];
        }
        offset = match.index + match[0].length;
    }
    append(line.slice(offset));
}
