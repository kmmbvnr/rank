import { mapsScalarCells } from './types.js';
import { matchCompiledCallSignature, type CompiledAtomType, type Operation } from '../operations.js';
import { isAtom, type ValueFacts } from './value-domain.js';

/** A catalogue contract applies only to proven scalar operands in its domain. */
export function hasScalarNoCallbackProof(operation: Operation, operands: readonly ValueFacts[]): boolean {
    const domain = operation.scalarNoCallback;
    return !!domain && !operation.effects?.length && operation.arities.includes(operands.length)
        && operands.every(value => value.rank === 0 && value.types.length > 0
            && value.types.every(type => type === 'integer' || domain === 'number' && type === 'real'));
}

/** A scalar-cell array may be eager or a lazy array with a proved callback-free reader. */
export function hasScalarCellArrayNoCallbackProof(operation: Operation, operands: readonly ValueFacts[]): boolean {
    const value = operands[0];
    const domain = operation.scalarCellArrayNoCallback;
    return !!domain && !operation.effects?.length
        && operands.length === 1 && operation.arities.includes(1)
        && value.types.join() === 'array'
        && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true)
        && !!value.elements?.length && value.elements.every(type => domain === 'boolean'
            ? type === 'boolean' : type === 'integer' || type === 'real');
}

/** A mapped scalar builtin reads only proved numeric cells from its array input. */
export function hasMappedScalarNoCallbackProof(operation: Operation, operands: readonly ValueFacts[]): boolean {
    const value = operands[0];
    const domain = operation.scalarNoCallback;
    return !!domain && !operation.effects?.length && operation.arities.includes(1)
        && operands.length === 1 && mapsScalarCells(operation)
        && value.types.join() === 'array' && !!value.shape
        && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true)
        && !!value.elements?.length && value.elements.every(type => type === 'integer'
            || domain === 'number' && type === 'real');
}

/** Every array read by this builtin has numeric cells that cannot run Rank code. */
export function hasNumericArrayNoCallbackProof(operation: Operation, operands: readonly ValueFacts[]): boolean {
    return operation.numericArrayNoCallback === true && !operation.effects?.length
        && operation.arities.includes(operands.length)
        && operands.some(value => value.types.join() === 'array')
        && operands.every(value => value.types.join() === 'array'
            ? (value.eagerScalarCells === true || value.callbackFreeScalarCells === true)
                && !!value.elements?.length
                && value.elements.every(type => type === 'integer' || type === 'real')
            : value.rank === 0 && value.types.length > 0
                && value.types.every(type => type === 'integer' || type === 'real'));
}

/** A known Rank array's shape can be read without touching a lazy cell. */
export function hasArrayHeaderNoCallbackProof(operation: Operation, operands: readonly ValueFacts[]): boolean {
    const value = operands[0];
    return operation.arrayHeaderNoCallback === true && !operation.effects?.length
        && operands.length === 1 && operation.arities.includes(1)
        && value.types.join() === 'array'
        && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true);
}

/** `find` and `findall` hash every source cell and the target without invoking Rank code. */
export function hasCallbackFreeFindProof(source: ValueFacts, target: ValueFacts): boolean {
    const scalar = (type: string) => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type);
    return (source.types.join() === 'text' || source.types.join() === 'array'
        && source.rank === 1 && (source.eagerScalarCells === true || source.callbackFreeScalarCells === true)
        && !!source.elements?.length && source.elements.every(scalar))
        && isAtom(target) && target.types.length > 0 && target.types.every(scalar);
}

/** The native profile is a positive proof only for complete operand domains.
 * Text stays rank one. Array types alone never prove that cell reads are safe;
 * bytes and host overrides need representation/runtime facts unavailable here. */
export function hasCompiledCallNoCallbackProof(operation: Operation, operands: readonly ValueFacts[]): boolean {
    const signature = operation.compiledCall;
    if (!signature || signature.hostFunction || operation.effects?.length) return false;
    const types: (CompiledAtomType | 'text-array')[] = [];
    for (const value of operands) {
        const type = value.types.length === 1 ? value.types[0] : undefined;
        if (type === 'text' && value.rank === 1) types.push(type);
        else if ((type === 'integer' || type === 'real' || type === 'boolean') && value.rank === 0) types.push(type);
        else if (type === 'array' && signature.callbacks === 'read-cells' && value.rank === 1
            && value.elements?.join() === 'text'
            && (value.eagerScalarCells === true || value.callbackFreeScalarCells === true)) types.push('text-array');
        else return false;
    }
    return !!matchCompiledCallSignature(operation, types);
}
