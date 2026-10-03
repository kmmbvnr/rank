import type { CompiledAtomType } from './operations.js';

/** The current scalar-function backend supports only these catalogue types. */
export type CompiledScalarType = Extract<CompiledAtomType, 'integer' | 'boolean'>;

export interface CompiledOperatorSignature<T extends CompiledAtomType = CompiledAtomType> {
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
    readonly unary?: '' | '-' | '!';
    readonly binary?: '+' | '-' | '*' | '//' | '%' | '**' | '<' | '>' | '<=' | '>=' | '===' | '!==' | '&&' | '||';
}

const integerUnary: CompiledOperatorSignature<CompiledScalarType> = { inputs: ['integer'], result: 'integer' };
const integerBinary: CompiledOperatorSignature<CompiledScalarType> = { inputs: ['integer', 'integer'], result: 'integer', compound: true };
const integerComparison: CompiledOperatorSignature<CompiledScalarType> = { inputs: ['integer', 'integer'], result: 'boolean' };
const booleanComparison: CompiledOperatorSignature<CompiledScalarType> = { inputs: ['boolean', 'boolean'], result: 'boolean' };
const booleanBinary: CompiledOperatorSignature<CompiledScalarType> = { ...booleanComparison, compound: true };
const textComparison: CompiledOperatorSignature = { inputs: ['text', 'text'], result: 'boolean' };
const signed = [integerUnary, integerBinary];
const equality = [integerComparison, booleanComparison];
const booleanUnary: CompiledOperatorSignature<CompiledScalarType> = { inputs: ['boolean'], result: 'boolean' };

export const compiledOperators: readonly CompiledOperator[] = [
    { name: '+', unary: '', binary: '+', scalarFunction: signed,
        integerLoop: [...signed, { inputs: ['text', 'text'], result: 'text', compound: true, nativeCalls: true }] },
    { name: '-', unary: '-', binary: '-', scalarFunction: signed, integerLoop: signed },
    ...(['*', '//', '%'] as const).map(name => ({ name, binary: name,
        scalarFunction: [integerBinary], integerLoop: [integerBinary] })),
    ...([['less', '<'], ['greater', '>'], ['atmost', '<='], ['atleast', '>=']] as const)
        .map(([name, binary]) => ({ name, binary, scalarFunction: [integerComparison], integerLoop: [integerComparison] })),
    ...([['equal', '==='], ['notequal', '!==']] as const)
        .map(([name, binary]) => ({ name, binary, scalarFunction: equality, integerLoop: [...equality, textComparison] })),
    ...([['and', '&&'], ['or', '||'], ['xor', '!==']] as const)
        .map(([name, binary]) => ({ name, binary, scalarFunction: [booleanBinary], integerLoop: [booleanBinary] })),
    { name: 'not', unary: '!', scalarFunction: [booleanUnary], integerLoop: [booleanUnary] },
    // The loop emitter additionally requires a nonnegative literal exponent.
    { name: '**', binary: '**', scalarFunction: [],
        integerLoop: [{ inputs: ['integer', 'integer'], result: 'integer' }] },
];
const operatorIndex = new Map(compiledOperators.map(operation => [operation.name, operation]));
export function findCompiledOperator(name: string): CompiledOperator | undefined { return operatorIndex.get(name); }

function match<T extends CompiledAtomType>(signatures: readonly CompiledOperatorSignature<T>[] | undefined, inputs: readonly T[]) {
    return signatures?.find(signature => signature.inputs.length === inputs.length
        && signature.inputs.every((type, index) => type === inputs[index]));
}
export function scalarOperatorSignature(name: string, inputs: readonly CompiledScalarType[]): CompiledOperatorSignature<CompiledScalarType> | undefined {
    return match(findCompiledOperator(name)?.scalarFunction, inputs);
}
export function loopOperatorSignature(name: string, inputs: readonly CompiledAtomType[], nativeCalls: boolean): CompiledOperatorSignature | undefined {
    const signature = match(findCompiledOperator(name)?.integerLoop, inputs);
    return signature?.nativeCalls && !nativeCalls ? undefined : signature;
}
