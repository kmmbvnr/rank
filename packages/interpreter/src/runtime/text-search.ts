import { checkpoint } from '../interrupt.js';

/** Text positions are Unicode code points, like text addressing and iteration. */
export function isSingleCodePoint(value: string): boolean {
    return value.length === 1 || value.length === 2 && value.codePointAt(0)! > 0xffff;
}

/** Streaming KMP; first-match consumers stop without scanning the remaining text. */
export function* textMatchPositions(source: string, target: string): IterableIterator<bigint> {
    // Preserve the existing empty-target contract: no matching character/span.
    if (!target.length) return;
    let position = 0;
    if (isSingleCodePoint(target)) {
        for (const point of source) {
            checkpoint('searching text');
            if (point === target) yield BigInt(position);
            position++;
        }
        return;
    }
    const pattern: string[] = [];
    for (const point of target) {
        checkpoint('preparing text search');
        pattern.push(point);
    }
    const prefixes = new Uint32Array(pattern.length);
    for (let i = 1, matched = 0; i < pattern.length; i++) {
        checkpoint('preparing text search');
        while (matched && pattern[i] !== pattern[matched]) {
            checkpoint('preparing text search');
            matched = prefixes[matched - 1];
        }
        if (pattern[i] === pattern[matched]) matched++;
        prefixes[i] = matched;
    }
    let matched = 0;
    for (const point of source) {
        checkpoint('searching text');
        while (matched && point !== pattern[matched]) {
            checkpoint('searching text');
            matched = prefixes[matched - 1];
        }
        if (point === pattern[matched]) matched++;
        if (matched === pattern.length) {
            // Keep the longest matching suffix so overlapping matches survive.
            matched = prefixes[matched - 1];
            yield BigInt(position - pattern.length + 1);
        }
        position++;
    }
}
