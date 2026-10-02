export interface ManualEntry {
    name: string;
    summary: string;
    synopsis: string;
    description: string;
    examples: { code: string; explanation: string }[];
}

// Every page is a checked-in document. No network or generated usage fallback.
const documents = import.meta.glob('../../../docs/manual/*.md', {
    eager: true, query: '?raw', import: 'default',
}) as Record<string, string>;
const pages = new Map<string, ManualEntry>();
for (const text of Object.values(documents)) {
    const parts = text.split(/^## (.+)$/m);
    for (let at = 1; at < parts.length; at += 2) {
        const name = parts[at].trim();
        const fields = parts[at + 1].split(/^### (.+)$/m);
        const sections = new Map<string, string>();
        for (let i = 1; i < fields.length; i += 2) sections.set(fields[i], fields[i + 1].trim());
        const examples = sections.get('EXAMPLES') ?? '';
        const code = /```rank\n([\s\S]*?)```/.exec(examples);
        if (pages.has(name)) throw new Error(`Duplicate bundled manual: ${name}`);
        pages.set(name, {
            name,
            summary: (sections.get('NAME') ?? '').replace(/\s+/g, ' '),
            synopsis: (sections.get('SYNOPSIS') ?? '').replace(/^```text\n|\n```$/g, ''),
            description: (sections.get('DESCRIPTION') ?? '').split(/\n\s*\n/).map(paragraph => paragraph.replace(/\s+/g, ' ')).join('\n\n'),
            examples: code ? [{ code: code[1].trimEnd(), explanation: examples.slice(0, code.index).trim().replace(/\s+/g, ' ') }] : [],
        });
    }
}

export function keyManual(key: string, _module = 'core'): ManualEntry {
    const entry = pages.get(key);
    if (!entry) throw new Error(`Missing bundled manual: ${key}`);
    return entry;
}
