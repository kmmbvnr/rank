/**
 * Symbolic dimensions: linear forms `c + Σ kᵢ·xᵢ` over natural-number variables
 * (Rank's version of the index theory in "The Semantics of Rank Polymorphism", §2.2).
 * A canonical form is a constant plus a variable map without zero coefficients, so
 * equality is structural. Multiplication of two symbols and inequalities are out of
 * scope on purpose.
 */
export interface Dim {
    readonly constant: number;
    /** Variable id to positive coefficient, ordered by id. */
    readonly terms: readonly (readonly [string, number])[];
}

export type Comparison = 'equal' | 'distinct' | 'unknown';

let nextVariable = 0;

/** A variable no other dimension mentions: one external or data-dependent length. */
export function freshDim(prefix = 'd'): Dim {
    return { constant: 0, terms: [[`${prefix}${++nextVariable}`, 1]] };
}

export function constantDim(value: number): Dim {
    return { constant: value, terms: [] };
}

export function variableDim(id: string): Dim {
    return { constant: 0, terms: [[id, 1]] };
}

export function addDims(...dims: readonly Dim[]): Dim {
    const terms = new Map<string, number>();
    let constant = 0;
    for (const dim of dims) {
        constant += dim.constant;
        for (const [id, coefficient] of dim.terms) terms.set(id, (terms.get(id) ?? 0) + coefficient);
    }
    return { constant, terms: [...terms].filter(([, coefficient]) => coefficient !== 0)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) };
}

export function isConstantDim(dim: Dim): boolean {
    return dim.terms.length === 0;
}

export function sameDim(left: Dim, right: Dim): boolean {
    return left.constant === right.constant && left.terms.length === right.terms.length
        && left.terms.every(([id, coefficient], index) => id === right.terms[index][0] && coefficient === right.terms[index][1]);
}

/**
 * Same canonical form is proven equal. Two different constants are provably distinct.
 * Anything else stays unknown: a symbol may be any natural number (and broadcast as 1).
 */
export function compareDims(left: Dim, right: Dim): Comparison {
    if (sameDim(left, right)) return 'equal';
    return isConstantDim(left) && isConstantDim(right) ? 'distinct' : 'unknown';
}

/** A single dimension of an array fact: a number when known, or a symbolic form. */
export function dimFromNumber(value: number | null | undefined): Dim | undefined {
    return typeof value === 'number' ? constantDim(value) : undefined;
}

export function formatDim(dim: Dim): string {
    const parts = dim.terms.map(([id, coefficient]) => coefficient === 1 ? id : `${coefficient}${id}`);
    if (dim.constant !== 0 || parts.length === 0) parts.push(String(dim.constant));
    return parts.join(' + ');
}
