import type { CompiledAtomType, CompiledLoopType } from './operations.js';

/** The current scalar-function backend supports only these catalogue types. */
export const compiledScalarTypes = ['integer', 'real', 'boolean', 'text'] as const satisfies readonly CompiledAtomType[];
export type CompiledScalarType = typeof compiledScalarTypes[number];
export type CompiledExpressionType = Extract<CompiledAtomType, 'integer' | 'real' | 'boolean'>;
export type CompiledTensorType = Extract<CompiledAtomType, 'integer' | 'real' | 'boolean'>;

export interface CompiledOperatorSignature<T extends CompiledAtomType = CompiledLoopType> {
    readonly inputs: readonly T[];
    readonly result: T;
    /** The corresponding compound assignment preserves the binding type. */
    readonly compound?: true;
    /** Text concatenation belongs to the existing optional native loop path. */
    readonly nativeCalls?: true;
}

/** Compiler eligibility for pure operators, not their complete language types.
 * Each backend opts in explicitly. Templates describe the JS token; floor
 * division/remainder, short circuiting and literal-power guards need structured
 * lowering in the backend to preserve evaluation order and error locations.
 */
export interface CompiledOperator {
    readonly name: string;
    readonly scalarFunction: readonly CompiledOperatorSignature<CompiledScalarType>[];
    readonly integerLoop: readonly CompiledOperatorSignature[];
    readonly scalarExpression?: readonly CompiledOperatorSignature<CompiledExpressionType>[];
    readonly tensor?: readonly CompiledOperatorSignature<CompiledTensorType>[];
    readonly unary?: '' | '-' | '!';
    readonly binary?: '+' | '-' | '*' | '/' | '//' | '%' | '**' | '<' | '>' | '<=' | '>=' | '===' | '!==' | '&&' | '||';
}

const integerUnary: CompiledOperatorSignature<'integer'> = { inputs: ['integer'], result: 'integer' };
const integerBinary: CompiledOperatorSignature<'integer'> = { inputs: ['integer', 'integer'], result: 'integer', compound: true };
const integerComparison: CompiledOperatorSignature<'integer' | 'boolean'> = { inputs: ['integer', 'integer'], result: 'boolean' };
const booleanComparison: CompiledOperatorSignature<'boolean'> = { inputs: ['boolean', 'boolean'], result: 'boolean' };
const booleanBinary: CompiledOperatorSignature<'boolean'> = { ...booleanComparison, compound: true };
const textComparison: CompiledOperatorSignature<'text' | 'boolean'> = { inputs: ['text', 'text'], result: 'boolean' };
const signed = [integerUnary, integerBinary];
const equality = [integerComparison, booleanComparison];
const booleanUnary: CompiledOperatorSignature<'boolean'> = { inputs: ['boolean'], result: 'boolean' };

const tensorArithmetic: readonly CompiledOperatorSignature<CompiledTensorType>[] = [
    { inputs: ['integer', 'integer'], result: 'integer' },
    { inputs: ['real', 'real'], result: 'real' },
    { inputs: ['integer', 'real'], result: 'real' },
    { inputs: ['real', 'integer'], result: 'real' },
];
const tensorSigned: readonly CompiledOperatorSignature<CompiledTensorType>[] = [
    integerUnary, { inputs: ['real'], result: 'real' }, ...tensorArithmetic,
];
// Existing tensor comparisons require matching numeric domains, including equal.
const tensorComparison: readonly CompiledOperatorSignature<CompiledTensorType>[] = [
    integerComparison, { inputs: ['real', 'real'], result: 'boolean' },
];

// The scalar-expression kernel falls back per operation for other values.
// Its direct binary fast paths accept matching numeric domains; comparisons
// currently inline integers only, while unary signs also inline real values.
const expressionArithmetic: readonly CompiledOperatorSignature<CompiledExpressionType>[] = [
    integerBinary, { inputs: ['real', 'real'], result: 'real' },
];
const expressionSigned: readonly CompiledOperatorSignature<CompiledExpressionType>[] = [
    integerUnary, { inputs: ['real'], result: 'real' }, ...expressionArithmetic,
];

const scalarArithmetic: readonly CompiledOperatorSignature<CompiledScalarType>[] = tensorArithmetic.map(signature => ({
    ...signature, ...(signature.inputs[0] === signature.result ? { compound: true as const } : {}),
}));
const scalarSigned: readonly CompiledOperatorSignature<CompiledScalarType>[] = [
    integerUnary, { inputs: ['real'], result: 'real' }, ...scalarArithmetic,
];
const scalarComparison: readonly CompiledOperatorSignature<CompiledScalarType>[] = tensorArithmetic.map(signature => ({
    inputs: signature.inputs, result: 'boolean',
}));

export const compiledOperators: readonly CompiledOperator[] = [
    { name: '+', unary: '', binary: '+', scalarFunction: [...scalarSigned, { inputs: ['text', 'text'], result: 'text', compound: true }], scalarExpression: expressionSigned, tensor: tensorSigned,
        integerLoop: [...signed, { inputs: ['text', 'text'], result: 'text', compound: true, nativeCalls: true }] },
    { name: '-', unary: '-', binary: '-', scalarFunction: scalarSigned, scalarExpression: expressionSigned, integerLoop: signed, tensor: tensorSigned },
    ...(['*', '//', 'mod'] as const).map(name => ({ name, binary: (name === 'mod' ? '%' : name) as '%' | '*' | '//',
        scalarFunction: name === '*' ? scalarArithmetic : [integerBinary], scalarExpression: name === '*' ? expressionArithmetic : [integerBinary], integerLoop: [integerBinary], tensor: name === '*' ? tensorArithmetic : undefined })),
    ...([['less', '<'], ['greater', '>'], ['atmost', '<='], ['atleast', '>=']] as const)
        .map(([name, binary]) => ({ name, binary, scalarFunction: scalarComparison, scalarExpression: [integerComparison], integerLoop: [integerComparison], tensor: tensorComparison })),
    ...([['equal', '==='], ['notequal', '!==']] as const)
        .map(([name, binary]) => ({ name, binary, scalarFunction: [...scalarComparison, booleanComparison, textComparison], scalarExpression: [integerComparison], integerLoop: [...equality, textComparison], tensor: tensorComparison })),
    ...([['and', '&&'], ['or', '||'], ['xor', '!==']] as const)
        .map(([name, binary]) => ({ name, binary, scalarFunction: [booleanBinary], integerLoop: [booleanBinary], tensor: [booleanComparison] })),
    { name: 'not', unary: '!', scalarFunction: [booleanUnary], scalarExpression: [booleanUnary], integerLoop: [booleanUnary], tensor: [booleanUnary] },
    // The loop emitter additionally requires a nonnegative literal exponent.
    { name: '**', binary: '**', scalarFunction: [],
        integerLoop: [{ inputs: ['integer', 'integer'], result: 'integer' }], tensor: tensorArithmetic },
    { name: '/', binary: '/', scalarFunction: [], integerLoop: [],
        tensor: tensorArithmetic.map(signature => ({ ...signature, result: 'real' })) },
];
const operatorIndex = new Map(compiledOperators.map(operation => [operation.name, operation]));
export function findCompiledOperator(name: string): CompiledOperator | undefined { return operatorIndex.get(name); }

export function matchCompiledOperatorSignature<T extends CompiledAtomType>(signatures: readonly CompiledOperatorSignature<T>[] | undefined, inputs: readonly T[]) {
    return signatures?.find(signature => signature.inputs.length === inputs.length
        && signature.inputs.every((type, index) => type === inputs[index]));
}
export function scalarOperatorSignature(name: string, inputs: readonly CompiledScalarType[]): CompiledOperatorSignature<CompiledScalarType> | undefined {
    return matchCompiledOperatorSignature(findCompiledOperator(name)?.scalarFunction, inputs);
}
export function loopOperatorSignature(name: string, inputs: readonly CompiledLoopType[], nativeCalls: boolean): CompiledOperatorSignature | undefined {
    const signature = matchCompiledOperatorSignature(findCompiledOperator(name)?.integerLoop, inputs);
    return signature?.nativeCalls && !nativeCalls ? undefined : signature;
}

/** Tensor guards currently specialize boolean, comparison and numeric families.
 * Layout, empty-domain timing, finite values and exponent bounds stay guarded
 * by the tensor backend; declaring an overload does not remove those guards.
 */
export function tensorOperatorSignatures(name: string, arity: number): readonly CompiledOperatorSignature<CompiledTensorType>[] {
    return findCompiledOperator(name)?.tensor?.filter(signature => signature.inputs.length === arity) ?? [];
}

export function expressionOperatorSignatures(name: string, arity: number): readonly CompiledOperatorSignature<CompiledExpressionType>[] {
    return findCompiledOperator(name)?.scalarExpression?.filter(signature => signature.inputs.length === arity) ?? [];
}

/** Possible results of the declared overloads for unresolved input domains.
 * A consumer must still guard the actual inputs before using these overloads. */
export function matchCompiledOperatorDomains<T extends CompiledAtomType>(
    signatures: readonly CompiledOperatorSignature<T>[] | undefined,
    inputs: readonly (readonly CompiledAtomType[])[],
) {
    const overloads = signatures?.filter(signature => signature.inputs.length === inputs.length
        && signature.inputs.every((type, index) => inputs[index].includes(type)));
    return overloads?.length ? { inputs, result: [...new Set(overloads.map(signature => signature.result))], overloads } : undefined;
}
