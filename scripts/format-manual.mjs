// Rewrap prose in docs/manual to 40 columns, leaving headings and fenced code alone.
// Usage: node scripts/format-manual.mjs [file.md ...]   (defaults to every page)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const width = 40;
const directory = new URL('../docs/manual/', import.meta.url);
const files = process.argv.slice(2).length ? process.argv.slice(2).map(file => new URL(file, `file://${process.cwd()}/`))
    : readdirSync(directory).filter(file => file.endsWith('.md') && file !== 'README.md').map(file => new URL(file, directory));

function wrap(text) {
    const lines = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
        if (line && [...line].length + 1 + [...word].length > width) { lines.push(line); line = word; }
        else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    return lines;
}

for (const file of files) {
    const out = [];
    let paragraph = [];
    let fenced = false;
    const flush = () => { if (paragraph.length) out.push(...wrap(paragraph.join(' '))); paragraph = []; };
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.startsWith('```')) { flush(); fenced = !fenced; out.push(line); }
        else if (fenced || line.startsWith('#')) out.push(line);
        else if (!line.trim()) { flush(); out.push(''); }
        else paragraph.push(line.trim());
    }
    flush();
    writeFileSync(file, out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n'));
}
