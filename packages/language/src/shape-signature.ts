/** null is an unexpressed dimension; exists explicitly marks dependence on values. */
export type ShapeDimension = number | string | null
    | { readonly add: readonly (number | string)[] } | { readonly exists: string };
export type ShapeTerm = ShapeDimension | { readonly spread: string };
/** At most one spread per pattern; fixed dimensions can precede or follow it. */
export type ShapePattern = readonly ShapeTerm[];
export interface ShapeSignature {
    /** null accepts any shape, including an unknown rank. Patterns describe cells. */
    readonly args: readonly (ShapePattern | null)[];
    /** null means even the result rank needs value information. */
    readonly result: ShapePattern | null;
}
export type KnownShape = readonly (number | null)[];

const spread = (term: ShapeTerm): term is { readonly spread: string } =>
    term !== null && typeof term === 'object' && 'spread' in term;
const natural = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Validate catalogue literals, including variable sorts and unbound result names. */
export function validateShapeSignature(signature: ShapeSignature): readonly string[] {
    const errors: string[] = [];
    const variables = new Map<string, 'dimension' | 'shape'>();
    const variable = (name: string, sort: 'dimension' | 'shape', result: boolean) => {
        if (!/^[a-z][a-z0-9]*$/i.test(name)) errors.push(`invalid variable ${name}`);
        const previous = variables.get(name);
        if (previous && previous !== sort) errors.push(`${name} used as both dimension and shape`);
        if (result && !previous) errors.push(`unbound result variable ${name}`);
        if (!result) variables.set(name, sort);
    };
    const pattern = (value: ShapePattern | null, result: boolean) => {
        if (value === null) return;
        if (value.filter(spread).length > 1) errors.push('multiple spreads in one pattern');
        for (const term of value) {
            if (spread(term)) { variable(term.spread, 'shape', result); continue; }
            if (term !== null && typeof term === 'object' && 'exists' in term) {
                if (!result) errors.push('existential dimension in an argument');
                if (!/^[a-z][a-z0-9]*$/i.test(term.exists)) errors.push(`invalid variable ${term.exists}`);
                if (variables.has(term.exists)) errors.push(`existential shadows input variable ${term.exists}`);
                continue;
            }
            const terms = term !== null && typeof term === 'object' ? term.add : [term];
            if (terms.length === 0) errors.push('empty dimension sum');
            for (const dim of terms) {
                if (typeof dim === 'string') variable(dim, 'dimension', result);
                else if (dim !== null && !natural(dim)) errors.push(`invalid dimension ${dim}`);
            }
        }
    };
    signature.args.forEach(arg => pattern(arg, false));
    pattern(signature.result, true);
    return errors;
}

/**
 * Instantiate a cell contract. No input values are read. Unknown dimensions stay
 * null; incompatible known dimensions or an unknown result rank return undefined.
 * This solves direct bindings and sums with one unknown variable, not arbitrary
 * systems of integer equations.
 */
export function instantiateShapeSignature(
    signature: ShapeSignature, args: readonly (KnownShape | undefined)[],
): KnownShape | undefined {
    if (args.length !== signature.args.length) return;
    const dimensions = new Map<string, number>();
    const shapes = new Map<string, KnownShape>();
    const equations: [ShapeDimension, number][] = [];
    const bind = (name: string, value: number): boolean => {
        const old = dimensions.get(name);
        if (old !== undefined && old !== value) return false;
        dimensions.set(name, value);
        return true;
    };
    for (let i = 0; i < args.length; i++) {
        const pattern = signature.args[i];
        const shape = args[i];
        if (pattern === null || shape === undefined) continue;
        if (shape.some(n => n !== null && !natural(n))) return;
        const at = pattern.findIndex(spread);
        const fixed = pattern.length - (at < 0 ? 0 : 1);
        if (at < 0 ? shape.length !== fixed : shape.length < fixed) return;
        for (let j = 0; j < pattern.length; j++) {
            const term = pattern[j];
            if (spread(term)) {
                const value = shape.slice(j, shape.length - (pattern.length - j - 1));
                const old = shapes.get(term.spread);
                if (old && (old.length !== value.length
                    || old.some((n, k) => n !== null && value[k] !== null && n !== value[k]))) return;
                shapes.set(term.spread, value.map((n, k) => n ?? old?.[k] ?? null));
            } else {
                const n = shape[at >= 0 && j > at ? shape.length - (pattern.length - j) : j];
                if (n === null || term === null) continue;
                if (typeof term === 'number') { if (term !== n) return; }
                else if (typeof term === 'string') { if (!bind(term, n)) return; }
                else if ('add' in term) equations.push([term, n]);
                else return;
            }
        }
    }
    // Each productive pass binds a variable, so this terminates without a solver.
    let changed = true;
    while (changed) {
        changed = false;
        for (const [expression, expected] of equations) {
            if (expression === null || typeof expression !== 'object' || !('add' in expression)) continue;
            let constant = 0;
            const unknown = new Map<string, number>();
            for (const term of expression.add) {
                const value = typeof term === 'number' ? term : dimensions.get(term);
                if (value === undefined) unknown.set(term as string, (unknown.get(term as string) ?? 0) + 1);
                else constant += value;
            }
            if (unknown.size === 0) { if (constant !== expected) return; }
            else if (unknown.size === 1) {
                const [name, coefficient] = [...unknown][0];
                const value = (expected - constant) / coefficient;
                if (!natural(value) || !bind(name, value)) return;
                changed = true;
            } else if (constant > expected) return;
        }
    }
    if (signature.result === null) return;
    const result: (number | null)[] = [];
    for (const term of signature.result) {
        if (spread(term)) {
            const value = shapes.get(term.spread);
            if (!value) return;
            result.push(...value);
        } else if (term !== null && typeof term === 'object' && 'exists' in term) {
            result.push(null);
        } else if (term !== null && typeof term === 'object') {
            const values = term.add.map(n => typeof n === 'number' ? n : dimensions.get(n));
            const value = values.every(n => n !== undefined) ? (values as number[]).reduce((a, b) => a + b, 0) : null;
            result.push(value !== null && natural(value) ? value : null);
        } else result.push(typeof term === 'string' ? dimensions.get(term) ?? null : term);
    }
    return result;
}

/** Diagonal cell axes depend on shape and offset, never on element values. */
export function diagonalResultShape(shape: KnownShape, offset = 0): KnownShape | undefined {
    if (shape.length === 1) {
        const side = shape[0] === null ? null : shape[0] + Math.abs(offset);
        return [side, side];
    }
    if (shape.length === 2) return [shape.some(n => n === null) ? null : Math.max(0, Math.min(
        shape[0]! - Math.max(0, -offset), shape[1]! - Math.max(0, offset)))];
    return undefined;
}
