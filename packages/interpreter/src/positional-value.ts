import { ownedArray } from './array-storage.js';
import { ArrayBindingContract } from './array-binding-contract.js';
import { RankError } from './errors.js';
import { tuple, type RankValue } from './value.js';

/** Fresh parser output: a homogeneous collection or a fixed positional product. */
export function positionalValue(items: RankValue[]): RankValue {
    try { return new ArrayBindingContract('parsed array').check(ownedArray(items)); }
    catch (error) {
        if (!(error instanceof RankError) || error.rankKind !== 'TypeError') throw error;
        return tuple(items);
    }
}
