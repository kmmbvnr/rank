import type { CollectionElementType, RankArray } from './value.js';

/** Explicit construction evidence, including a fill whose result has no cells.
 * Kept apart from stored cells so reading a lazy cache cannot declare a type. */
const declarations = new WeakMap<RankArray, CollectionElementType>();

export function arrayDeclaration(value: RankArray): CollectionElementType | undefined {
    return declarations.get(value);
}

export function declareArray<T extends RankArray>(value: T, contract: CollectionElementType): T {
    declarations.set(value, contract);
    return value;
}

export function inheritArrayDeclaration(source: RankArray, target: RankArray): void {
    const contract = declarations.get(source);
    if (contract) declarations.set(target, { ...contract, rank: target.shape.length });
}
