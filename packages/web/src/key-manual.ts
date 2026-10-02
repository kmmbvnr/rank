export interface ManualEntry {
    name: string;
    module: string;
    summary: string;
    /** Prose between the summary and the example code. */
    caption: string;
    example: string;
    /** What the example prints and returns, kept current by manual.test.ts. */
    result: string;
    /** Usage code, its prose, then Notes or any other section; See also is split out. */
    sections: { heading: string; code: string; paragraphs: string[] }[];
    seeAlso: string[];
}

// Every page is a checked-in document. No network or generated usage fallback.
const documents = import.meta.glob(['../../../docs/manual/*.md', '!**/README.md'], {
    eager: true, query: '?raw', import: 'default',
}) as Record<string, string>;
const fence = /```(\w+)\n([\s\S]*?)```/;
// Pages are wrapped to 40 columns in source; the sheet reflows paragraphs.
const paragraphs = (text: string) => text.split(/\n\s*\n/).map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
const pages = new Map<string, ManualEntry>();
for (const [path, text] of Object.entries(documents)) {
    const module = /([^/]+)\.md$/.exec(path)![1];
    const parts = text.split(/^## (.+)$/m);
    for (let at = 1; at < parts.length; at += 2) {
        const name = parts[at].trim();
        const [lead, ...rest] = parts[at + 1].split(/^### (.+)$/m);
        const example = /```rank\n([\s\S]*?)```/.exec(lead);
        const result = /```result\n([\s\S]*?)```/.exec(lead);
        const intro = paragraphs(example ? lead.slice(0, example.index) : lead);
        const sections: ManualEntry['sections'] = [];
        let seeAlso: string[] = [];
        for (let i = 0; i < rest.length; i += 2) {
            const body = rest[i + 1];
            const code = fence.exec(body);
            if (rest[i] === 'See also') seeAlso = body.split(',').map(item => item.trim()).filter(Boolean);
            else sections.push({
                heading: rest[i],
                code: code?.[2].trimEnd() ?? '',
                paragraphs: paragraphs(code ? body.replace(code[0], '') : body),
            });
        }
        if (pages.has(name)) throw new Error(`Duplicate bundled manual: ${name}`);
        pages.set(name, {
            name, module, sections, seeAlso,
            summary: intro[0] ?? '',
            caption: intro.slice(1).join(' '),
            example: example?.[1].trimEnd() ?? '',
            result: result?.[1].trimEnd() ?? '',
        });
    }
}

export function keyManual(key: string): ManualEntry {
    const entry = pages.get(key);
    if (!entry) throw new Error(`Missing bundled manual: ${key}`);
    return entry;
}
