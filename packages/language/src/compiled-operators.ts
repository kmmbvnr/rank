import type { CompiledAtomType } from './operations.js';

/** The current scalar-function backend supports only these catalogue types. */
export type CompiledScalarType = Extract<CompiledAtomType, 'integer' | 'boolean'>;

export interface CompiledOperatorSignature {
    readonly inputs: readonly CompiledScalarType[];
    readonly result: CompiledScalarType;
    /** The corresponding compound assignment preserves the binding type. */
    readonly compound?: true;
}

/** Explicit compiler eligibility, not the complete language operator semantics.
 * Other backends must retain their own eligibility until their migration is
 * verified; adding an entry here must not silently enable a new backend path.
 */
export interface CompiledOperator {
    readonly name: string;
    readonly scalarFunction: readonly CompiledOperatorSignature[];
}

const integerUnary: CompiledOperatorSignature = { inputs: ['integer'], result: 'integer' };
const integerBinary: CompiledOperatorSignature = { inputs: ['integer', 'integer'], result: 'integer', compound: true };
const integerComparison: CompiledOperatorSignature = { inputs: ['integer', 'integer'], result: 'boolean' };
const booleanComparison: CompiledOperatorSignature = { inputs: ['boolean', 'boolean'], result: 'boolean' };
const booleanBinary: CompiledOperatorSignature = { ...booleanComparison, compound: true };

export const compiledOperators: readonly CompiledOperator[] = [
    ...['+', '-'].map(name => ({ name, scalarFunction: [integerUnary, integerBinary] })),
    ...['*', '//', '%'].map(name => ({ name, scalarFunction: [integerBinary] })),
    ...['less', 'greater', 'atmost', 'atleast'].map(name => ({ name, scalarFunction: [integerComparison] })),
    ...['equal', 'notequal'].map(name => ({ name, scalarFunction: [integerComparison, booleanComparison] })),
    ...['and', 'or', 'xor'].map(name => ({ name, scalarFunction: [booleanBinary] })),
    { name: 'not', scalarFunction: [{ inputs: ['boolean'], result: 'boolean' }] },
];
const operatorIndex = new Map(compiledOperators.map(operation => [operation.name, operation]));

export function scalarOperatorSignature(name: string, inputs: readonly CompiledScalarType[]): CompiledOperatorSignature | undefined {
    return operatorIndex.get(name)?.scalarFunction.find(signature => signature.inputs.length === inputs.length
        && signature.inputs.every((type, index) => type === inputs[index]));
}
