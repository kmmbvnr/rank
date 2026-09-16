import type { RankValue } from './value.js';

/** Bounded diagnostic text; never evaluates lazy arrays or consumes sequences. */
export function summarizeValue(value: RankValue, depth = 0): string {
    if (typeof value === 'string') return JSON.stringify(value.slice(0, 80)) + (value.length > 80 ? '…' : '');
    if (typeof value !== 'object') return String(value);
    if (value.kind === 'array' || value.kind === 'bytes') {
        const label = `${value.kind}[${value.shape.join('×')}]`;
        if (depth >= 2 || value.itemAt) return label;
        const items = value.kind === 'bytes' ? value.data : value.items;
        const shown = Array.from(items.slice(0, 8), item => summarizeValue(item, depth + 1));
        return `${label}: ${shown.join(' ')}${items.length > 8 ? ' …' : ''}`;
    }
    if (value.kind === 'label') return `.${value.name}`;
    if (value.kind === 'function') return `<function ${value.name}>`;
    return `<${value.kind}>`;
}
