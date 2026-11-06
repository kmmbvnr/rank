import { ownedStorage } from './array-storage-state.js';
import type { RankValue } from './value.js';

/** Bounded diagnostic text; never evaluates lazy arrays or consumes sequences. */
export function summarizeValue(value: RankValue, depth = 0): string {
    if (typeof value === 'string') return JSON.stringify(value.slice(0, 80)) + (value.length > 80 ? '…' : '');
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return Number.isNaN(value) ? 'nan' : value > 0 ? 'infinity' : '-infinity';
    }
    if (typeof value !== 'object') return String(value);
    if (value.kind === 'array' || value.kind === 'bytes') {
        const label = `${value.kind}[${value.shape.join('×')}]`;
        if (depth >= 2 || value.itemAt) return label;
        // Stay below array-storage's errors/interrupt imports. Reading public
        // `.items` boxes the whole typed buffer, even for an eight-cell preview.
        const state = value.kind === 'array' ? ownedStorage.get(value) : undefined;
        if (state && !state.stable) return label;
        const items = value.kind === 'bytes' ? value.data : state?.items
            ?? Object.getOwnPropertyDescriptor(value, 'items')?.value as ArrayLike<RankValue> | undefined;
        if (!items) return label;
        const shown = Array.from({ length: Math.min(items.length, 8) }, (_, index) =>
            state?.validity && !(state.validity[index >>> 5] >>> (index & 31) & 1) ? '<missing>'
                : summarizeValue(items[index], depth + 1));
        return `${label}: ${shown.join(' ')}${items.length > 8 ? ' …' : ''}`;
    }
    if (value.kind === 'tuple') return depth >= 2 ? `tuple[${value.items.length}]`
        : `tuple: ${value.items.slice(0, 8).map(item => summarizeValue(item, depth + 1)).join(' ')}${value.items.length > 8 ? ' …' : ''}`;
    if (value.kind === 'label') return `.${value.name}`;
    if (value.kind === 'function') return `<function ${value.name}>`;
    return `<${value.kind}>`;
}

/** The raw Number call ABI admits only one-dimensional integer buffers. */
export function summarizeIntegerBuffer(value: ArrayLike<number | bigint>): string {
    const shown = Array.from({ length: Math.min(value.length, 8) }, (_, index) => String(BigInt(value[index])));
    return `array[${value.length}]: ${shown.join(' ')}${value.length > 8 ? ' …' : ''}`;
}
