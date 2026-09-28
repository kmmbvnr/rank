import type { ValueFacts } from './value-domain.js';

/** Values and axis lengths do not identify a function specialization. */
export function argumentSignature(inputs: readonly ValueFacts[], elements = true): string {
    return JSON.stringify(inputs.map(value => [[...value.types].sort(), value.rank ?? null,
        elements && value.elements ? [...value.elements].sort() : null]));
}

export function returnConflicts(values: readonly ValueFacts[]): { kind: 'TypeError' | 'DimensionMismatch'; message: string }[] {
    const conflicts: { kind: 'TypeError' | 'DimensionMismatch'; message: string }[] = [];
    const ranks = [...new Set(values.flatMap(value => value.rank === undefined ? [] : [value.rank]))];
    if (ranks.length > 1) conflicts.push({ kind: 'DimensionMismatch',
        message: `returns incompatible ranks: ${ranks.join(' and ')}` });
    for (let i = 0; i < values.length; i++) for (const right of values.slice(i + 1)) {
        const left = values[i];
        const a = left.types.join() === 'array' ? left.elements ?? [] : left.types;
        const b = right.types.join() === 'array' ? right.elements ?? [] : right.types;
        if (a.length && b.length && !a.some(type => b.includes(type))) {
            conflicts.push({ kind: 'TypeError', message: `returns incompatible types: ${a.join(' or ')} and ${b.join(' or ')}` });
            return conflicts;
        }
    }
    return conflicts;
}

/** Retain types/ranks while forgetting data that could select just one return path. */
export function returnInput(value: ValueFacts): ValueFacts {
    return { types: value.types, rank: value.rank, elements: value.elements,
        ...(value.shape ? { shape: value.shape.map(() => null) } : {}),
        ...(value.fields ? { fields: Object.fromEntries(Object.entries(value.fields)
            .map(([name, fact]) => [name, returnInput(fact)])) } : {}) };
}
