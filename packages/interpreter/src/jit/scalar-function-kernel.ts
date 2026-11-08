import { tensorCells } from '../rank-application.js';
import { Operators, makeRange } from '../operators.js';
import { AstUtils } from 'langium';
import { PrivateNumericArray } from './number-loop-runtime.js';
import { checkedNumberModularMultiply, numberOverflow } from './number-arithmetic.js';
import { safeIntegerModularPower } from '../modular-power.js';
import { safeIntegerGcd } from '../integer-gcd.js';
import { safeIntegerSquareRoot } from '../integer-square-root.js';
import { checkValueMutable } from '../value-protection.js';
import { completed } from '../execution.js';
import { denseScalarItems } from '../array-storage.js';
import { isBorrowedIntegerBuffer } from './borrowed-integer-buffer.js';
import { materializeValue } from '../materialize.js';
import { binaryOperatorSource, scalarExtremeSource, zeroTestSource, numberBitwiseSource } from './operator-codegen.js';
import { numericBoundSource } from './numeric-bound-codegen.js';
import { membershipLookup } from '../membership-lookup.js';
import { type CompiledCalleeType, isCompiledContainer, sameCompiledCalleeType } from './compiled-callee-type.js';
import { newStructure, addToCollection, expectAddCollection, setHas } from '../collections.js';
import { indexGet, indexHas, indexRead, indexSet, indexKey } from '../index-storage.js';
import {
    findCompiledOperator, applicationForm, findOperation, rangeSliceOperands,
    isArrayExpression, isReturnStatement, isExpressionStatement, isAssignmentStatement, isIfStatement, isForStatement, isBinaryExpression, isParenthesizedExpression, forIteration, isPushStatement, isNameExpression, isArrayAssignmentStatement, isBreakStatement, isContinueStatement, isUnpackStatement,
    type CompiledExpression, type CompiledOperator, type CompiledScalarType, type Operation, type Expression, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { sequenceValues } from '../sequence.js';
import { checkpoint, privateLoopPolling, demandBudgetEnabled } from '../interrupt.js';
import { argumentSelectionError, RankError } from '../errors.js';
import { currentDiagnostics, recordFallback } from '../diagnostics.js';
import { isRankArray, type RankArray, type RankSequence, type RankValue } from '../value.js';
import type { LoopCallable } from './integer-loop-plan.js';
import { scalarArrayWriteOffset } from '../selectors.js';
import { checkedArrayDimension } from '../tensor-index.js';
import { ArrayBindingScope, arrayValues, arrayForWrite, ownedArray, noteArrayBinding, derivedArray, readArrayItem, borrowArrayStorage, prepareScalarArrayWriter, prepareArrayReader, prepareScalarArrayReader, prepareMatrixArrayReader } from '../array-storage.js';
import { scalarSelection } from './scalar-selection.js';
import { takeDropValue } from '../sequence.js';
import { concatValues, copyArray, materializeArray, stackValues, reshapeWithDimensions, materializeCollection } from '../modules/sequences.js';
import { hasDeferredSelectionCopy } from '../integer-view.js';
import { scalarFunctionResult, privateScalarFunction, type ScalarFunctionProof, type ScalarFunctionInput, type ScalarCaptureTypes, type ScalarLoopIterable } from './scalar-function-proof.js';
import { emitFunctionPlan, functionPlanArrays, functionPlanCallbacks, FunctionPlanDemandError, type FunctionPlanConsumer, type FunctionPlan } from '../function-plan.js';
import { textAt, textPoints } from '../text-storage.js';
import { sortValue, argsortValue } from '../modules/sequence-order.js';
import { uniqueValue } from '../modules/sequence-distinct.js';
import { compareCells } from '../value-comparison.js';
import { applySelectors, unpackApplicationItems } from '../value-selection.js';
import { integerValue } from '../numeric-conversions.js';
import { formatValue } from '../value.js';
import { broadcastShape } from '../tensor.js';

interface Kernel {
    readonly source: string;
    readonly returnType?: CompiledCalleeType;
    readonly plans: boolean;
    readonly privateFolds: boolean;
    readonly deques: boolean;
    readonly setMembership: boolean;
    readonly userCalls: readonly { name: string; statement: FunctionStatement; types: readonly CompiledCalleeType[]; locals: readonly string[]; tail: boolean; recursive?: boolean; captures?: ScalarCaptureTypes }[];
    readonly rankedCalls: ScalarFunctionProof['planCalls'];
    readonly scalarCaptures: readonly { name: string; type: CompiledScalarType }[];
    readonly memberships: readonly string[];
    readonly captures: readonly { name: string; rank: number }[];
    readonly calls: readonly { operation: Operation; inputs: readonly string[]; native?: boolean; capturedArgument?: string; bound?: 'to' | 'till' }[];
    readonly guards: readonly string[];
    readonly modules: readonly string[];
    readonly locations: readonly (Statement | Expression)[];
    run(arguments_: RankValue[], locate: (error: unknown, index: number) => unknown, calls?: readonly LoopCallable[],
        userCalls?: readonly LoopCallable[],
        memberships?: readonly ((value: bigint) => boolean)[],
        captures?: readonly ((indices: bigint[]) => bigint)[], scalars?: readonly (() => RankValue)[], planConsumed?: () => void, rankedCalls?: readonly (() => (arguments_: RankValue[]) => RankValue)[], poll?: typeof checkpoint): RankValue;
    readonly direct?: (locate: (error: unknown, index: number) => unknown,
        calls?: readonly LoopCallable[],
        userCalls?: readonly LoopCallable[],
        memberships?: readonly ((value: bigint) => boolean)[],
        captures?: readonly ((indices: bigint[]) => bigint)[],
        scalars?: readonly (() => RankValue)[],
        planConsumed?: () => void,
        rankedCalls?: readonly (() => (arguments_: RankValue[]) => RankValue)[], poll?: typeof checkpoint) => LoopCallable;
    readonly numberStorage?: 'arrays' | 'queues';
    readonly numberArrayArguments: readonly number[];
    readonly numberDirect?: (locate: (error: unknown, index: number) => unknown,
        safe: (val: number) => number,
        zero: () => Error,
        overflow: unknown,
        checkpoint: () => void,
        power: (base: number, exponent: number) => number,
        badStep?: () => Error,
        powerZero?: () => Error,
        powerDomain?: () => Error,
        memberships?: readonly ((value: bigint) => boolean)[],
        users?: readonly LoopCallable[], planConsumed?: () => void) => LoopCallable;
}
const kernels = new WeakMap<ScalarFunctionProof, Kernel | null>();

function compileScalarNumberKernel(
    statement: FunctionStatement,
    proof: ScalarFunctionProof,
    parameterTypes: readonly CompiledCalleeType[],
    locations: readonly (Statement | Expression)[],
    memberships: readonly string[],
    users: Kernel['userCalls'],
): Kernel['numberDirect'] | undefined {
    if (proof.planReturn && typeof proof.type !== 'string') return undefined;
    if (!proof.localArrayWrites || proof.planCalls.length
        || proof.iterableBindings.size || proof.nativeReads.some(name => !['len', 'floor', 'ceil', 'abs', 'choose', 'min', 'max', 'isqrt', 'sum', 'count', 'powmod', 'gcd', 'band', 'bor', 'bxor'].includes(name))
        || proof.recursive || (proof.callCount ? !privateScalarFunction(proof, true)
            : proof.dependencies.some(name => !memberships.includes(name)))) return undefined;
    // Newly admitted captured memberships retain the exact kernel's reader
    // guards. Keep small inputs/counters explicitly Int32 for hot remainders;
    // wider inputs replay exactly rather than silently truncate.
    const narrowMembership = memberships.length > 0;
    const isNumType = (t: CompiledCalleeType) => t === 'integer' || t === 'real' || t === 'boolean';
    const arrayParameter = (t: CompiledCalleeType) => typeof t !== 'string' && !isCompiledContainer(t)
        && t.rank === 1 && t.element === 'integer';
    const vectorOperands = (value: CompiledExpression<CompiledCalleeType, ScalarFunctionInput>) => {
        while (value.kind === 'group') value = value.operand;
        return value.kind === 'input' && value.input.operation === 'vector' ? value.input : undefined;
    };
    // A fresh literal vector can be published once after every numeric guard
    // passed. Borrowed arrays and broader array expressions keep the exact tier.
    const vectorResult = arrayParameter(proof.type) && proof.returned.length > 0
        && proof.returned.every(value => !!vectorOperands(value));
    if ((!isNumType(proof.type) && !vectorResult) || !parameterTypes.every(t => isNumType(t) || arrayParameter(t))) return undefined;

    const slots = new Map<string, number>();
    const slot = (name: string): string => {
        if (!slots.has(name)) slots.set(name, slots.size);
        return `r${slots.get(name)}`;
    };
    statement.parameters.forEach(slot);
    let serial = 0;
    const parameterArrays = new Set(statement.parameters.filter((_,i) => arrayParameter(parameterTypes[i])));
    const arrays = new Set(parameterArrays), queues = new Set<string>();
    // Writes belong to this invocation; borrowed inputs stay read-only.
    // A guard bailout can discard all private writes.
    for (const [expression, value] of proof.expressions) {
        if (value.kind !== 'input' || !['array', 'new'].includes(value.input.operation ?? '')) continue;
        const owner = expression.$container;
        if (!owner || !isAssignmentStatement(owner) || owner.value !== expression || owner.operator !== '=') return undefined;
        if (value.input.operation === 'array') {
            if (typeof value.type === 'string' || isCompiledContainer(value.type)
                || value.type.rank !== 1 || !['integer', 'real'].includes(value.type.element)) return undefined;
            arrays.add(owner.name);
        } else {
            if (value.input.name !== 'queue') return undefined;
            queues.add(owner.name);
        }
    }
    const aliases: [string, string][] = [];
    const inputOf = (value: CompiledExpression<CompiledCalleeType, ScalarFunctionInput> | undefined) => {
        while (value?.kind === 'group') value = value.operand;
        return value?.kind === 'input' ? value : undefined;
    };
    for (const [expression, compiled] of proof.expressions) {
        const node = expression.$container;
        if (!isAssignmentStatement(node) || node.value !== expression) continue;
        const value = inputOf(compiled);
        if (!value || typeof value.type === 'string' || isCompiledContainer(value.type)) continue;
        if (value.type.rank !== 1 || !['integer', 'real'].includes(value.type.element)) return undefined;
        arrays.add(node.name);
        if (!value.input.operation && !value.input.indices) aliases.push([node.name, value.input.name]);
    }
    // Read-only aliases share buffers. Mutable local components reuse the
    // private loop's binding-level ownership and COW implementation.
    const borrowedArrays = new Set(parameterArrays);
    for (let size = -1; size !== borrowedArrays.size;) {
        size = borrowedArrays.size;
        for (const [target, source] of aliases) if (borrowedArrays.has(source)) borrowedArrays.add(target);
    }
    const aliased = new Set(aliases.flat());
    const cowArrays = new Set([...proof.arrayWrites].filter(isArrayAssignmentStatement)
        .map(node => node.name).filter(name => aliased.has(name)));
    for (let size = -1; size !== cowArrays.size;) {
        size = cowArrays.size;
        for (const [target, source] of aliases) if (cowArrays.has(target) || cowArrays.has(source)) {
            cowArrays.add(target); cowArrays.add(source);
        }
    }
    if ([...cowArrays].some(name => !proof.ownedStorage.has(name))) return undefined;
    const cells = (name: string) => `${slot(name)}${cowArrays.has(name) ? '.cells' : ''}`;
    const arrayBinding = (value: CompiledExpression<CompiledCalleeType, ScalarFunctionInput> | undefined) => {
        const input = inputOf(value)?.input;
        return input?.operation === 'array' || input && !input.operation && !input.indices && arrays.has(input.name);
    };
    function index(source: string, value: string, lines: string[]): string {
        const at = `at${serial++}`;
        lines.push(`const ${at} = ${value}; if (${at} < 0 || ${at} >= ${source}.length) throw overflow;`);
        return at;
    }

    function emitNum(expression: Expression, lines: string[]): string | undefined {
        const compiled = proof.expressions.get(expression);
        if (!compiled) return undefined;
        return lowerNum(compiled, lines);
    }

    function lowerNum(compiled: CompiledExpression<CompiledCalleeType, ScalarFunctionInput>, lines: string[]): string | undefined {
        if (compiled.kind === 'group') return lowerNum(compiled.operand, lines);
        if (compiled.kind === 'literal') {
            if (typeof compiled.value === 'bigint') {
                const n = Number(compiled.value);
                if (!Number.isSafeInteger(n)) return undefined;
                return String(n);
            }
            if (typeof compiled.value === 'number') {
                return Object.is(compiled.value, -0) ? '-0' : String(compiled.value);
            }
            if (typeof compiled.value === 'boolean') return String(compiled.value);
            return undefined;
        }
        if (compiled.kind === 'input') {
            const input = compiled.input;
            if (input.operation === 'plan') return numberPlan(input.plan!, lines);
            if (input.operation === 'user-call' && input.callee) {
                const callee = input.callee;
                if (!privateScalarFunction(callee.proof, true)
                    || !compileScalarFunction(callee.statement, callee.types, true, callee.captures)?.numberDirect) return undefined;
                const index = users.findIndex(call => call.name === input.name && call.statement === callee.statement
                    && call.types.every((type, index) => sameCompiledCalleeType(type, callee.types[index])));
                if (index < 0) return undefined;
                const args: string[] = [];
                for (const argument of input.indices ?? []) {
                    const value = lowerNum(argument, lines);
                    if (value === undefined) return undefined;
                    const name = `v${serial++}`;
                    lines.push(`const ${name} = ${value};`);
                    args.push(name);
                }
                const result = `v${serial++}`;
                lines.push(`const ${result} = users[${index}](${args.join(',')});`);
                return compiled.type === 'integer' ? `safe(${result})` : result;
            }
            if (input.operation === 'sequence-contains' || input.operation === 'sequence-not-contains') {
                const reader = memberships.indexOf(input.name);
                const value = lowerNum(input.indices![0], lines);
                if (reader < 0 || value === undefined) return undefined;
                return `${input.operation === 'sequence-not-contains' ? '!' : ''}memberships[${reader}](BigInt(safe(${value})))`;
            }

            if (input.operation === 'array') {
                const dimension = input.dimensions![0];
                let size = lowerNum(dimension.value, lines);
                if (!size) return undefined;
                if (dimension.negative) size = `-(${size})`;
                const count = `size${serial++}`, result = `v${serial++}`;
                // The private JS vector has the same length representation as
                // the exact allocator. Other dimensions retain its errors.
                lines.push(`const ${count} = safe(${size}); if (${count} < 0 || ${count} > 0xffffffff) throw overflow;`);
                const fill = lowerNum(input.indices![0], lines);
                if (!fill) return undefined;
                // Real cells keep fractional, nonfinite and signed-zero values.
                const initial = input.indices![0].type === 'integer' ? `safe(${fill})` : fill;
                const owner = compiled.source.$container;
                lines.push(`const ${result} = ${isAssignmentStatement(owner) && cowArrays.has(owner.name)
                    ? `new PrivateNumericArray([${count}], ${initial}, undefined, undefined, ${typeof compiled.type !== 'string' && !isCompiledContainer(compiled.type) && compiled.type.element === 'real'})`
                    : `Array(${count}).fill(${initial})`};`);
                return result;
            }
            if (input.operation === 'new' && input.name === 'queue') {
                const result = `v${serial++}`;
                lines.push(`const ${result} = [];`);
                return result;
            }
            if ((input.operation === 'array-len' && arrays.has(input.name))
                || (input.operation === 'len' && queues.has(input.name))) return `${cells(input.name)}.length`;
            if (input.operation === 'integer-power') {
                // The proof restricts the exponent to nonnegative integers.
                // Preserve unary-minus precedence and replay any unsafe result.
                const base = lowerNum(input.indices![0], lines), exponent = lowerNum(input.indices![1], lines);
                if (!base || !exponent) return undefined;
                const result = `v${serial++}`, literal = input.indices![1];
                // Match the loop backend: multiply squares inline; higher or
                // computed powers use checked products, never approximate pow.
                const code = literal.kind === 'literal' && literal.value === 0n ? '1'
                    : literal.kind === 'literal' && literal.value === 1n ? base
                    : literal.kind === 'literal' && literal.value === 2n ? `(${base}) * (${base})`
                    : `power(${base}, ${exponent})`;
                lines.push(`const ${result} = safe(${input.negative ? '-' : ''}(${code}));`);
                return result;
            }
            if (input.operation === 'choose') {
                const values: string[] = [];
                for (const operand of input.indices!) {
                    const value = lowerNum(operand, lines);
                    if (value === undefined) return undefined;
                    const name = `v${serial++}`;
                    lines.push(`const ${name} = ${value};`);
                    values.push(name);
                }
                const result = `v${serial++}`;
                lines.push(`const ${result} = ${values[0]} ? ${values[1]} : ${values[2]};`);
                return result;
            }
            if (input.operation) return undefined;
            if (input.indices) {
                if (!arrays.has(input.name) || input.indices.length !== 1) return undefined;
                const at = lowerNum(input.indices[0], lines);
                if (!at) return undefined;
                const value = `${cells(input.name)}[${index(cells(input.name), at, lines)}]`;
                return borrowedArrays.has(input.name) ? `safe(Number(${value}))` : value;
            }
            if (typeof compiled.type !== 'string' && !arrays.has(input.name)) return undefined;
            return cells(input.name);
        }
        if (compiled.kind === 'unary') {
            const val = lowerNum(compiled.operand, lines);
            if (!val) return undefined;
            const res = `v${serial++}`;
            if (compiled.operation.name === '-') {
                lines.push(`const ${res} = ${compiled.type === 'integer' ? `safe(-(${val}))` : `-(${val})`};`);
            } else if (compiled.operation.name === 'not') {
                lines.push(`const ${res} = !(${val});`);
            } else return undefined;
            return res;
        }
        if (compiled.kind === 'extreme') {
            const left = lowerNum(compiled.left, lines);
            if (!left) return undefined;
            if (!compiled.right) return left;
            const right = lowerNum(compiled.right, lines);
            if (!right) return undefined;
            const res = `v${serial++}`;
            lines.push(`const ${res} = ${scalarExtremeSource(compiled.name, left, right)};`);
            return res;
        }
        if (compiled.kind === 'call') {
            const name = compiled.operation.name;
            if (compiled.operation.module === 'bits' && ['band', 'bor', 'bxor'].includes(name)
                && compiled.arguments.length === 2 && compiled.arguments.every(argument => argument.type === 'integer')) {
                const args: string[] = [];
                for (const argument of compiled.arguments) {
                    const value = lowerNum(argument, lines);
                    if (value === undefined) return undefined;
                    const temporary = `v${serial++}`;
                    lines.push(`const ${temporary} = safe(${value});`);
                    args.push(temporary);
                }
                const result = `v${serial++}`;
                lines.push(`const ${result} = safe(${numberBitwiseSource(name as 'band' | 'bor' | 'bxor', args[0], args[1])});`);
                return result;
            }
            if (compiled.operation.module === 'numbers' && name === 'gcd' && compiled.arguments.length === 2
                && compiled.arguments.every(argument => argument.type === 'integer')) {
                const args = compiled.arguments.map(argument => lowerNum(argument, lines));
                if (args.some(argument => argument === undefined)) return undefined;
                const result = `v${serial++}`;
                lines.push(`const ${result} = gcd(${args.join(',')});`);
                return result;
            }
            if (compiled.operation.module === 'numbers' && name === 'powmod'
                && compiled.arguments.length === 3 && compiled.arguments.every(argument => argument.type === 'integer')) {
                const args = compiled.arguments.map(argument => lowerNum(argument, lines));
                if (args.some(argument => argument === undefined)) return undefined;
                const result = `v${serial++}`;
                lines.push(`const ${result} = powmod(${args.join(',')});`);
                return result;
            }
            if (compiled.operation.module !== 'numbers' || name !== 'floor' && name !== 'ceil' && name !== 'abs' && name !== 'isqrt'
                || compiled.arguments.length !== 1) return undefined;
            const argument = compiled.arguments[0];
            if (name === 'isqrt' && argument.type !== 'integer') return undefined;
            if (argument.type !== 'integer' && argument.type !== 'real') return undefined;
            const value = lowerNum(argument, lines);
            if (!value) return undefined;
            const result = `v${serial++}`;
            // Native binding guards are shared with the exact kernel. Nonfinite
            // or unsafe results replay there, retaining its domain errors.
            if (name === 'isqrt') {
                // Replay negative inputs in the exact kernel for its located
                // domain error. Safe inputs use the corrected integer root.
                lines.push(`if (${value} < 0) throw overflow; const ${result} = isqrt(${value});`);
                return result;
            }
            const absolute = `Math.abs(${value})`;
            const code = name === 'abs' ? compiled.type === 'integer' ? `safe(${absolute})` : absolute
                : numericBoundSource(name, value, argument.type, true);
            lines.push(`const ${result} = ${code};`);
            return result;
        }
        const op = compiled.operation.name;
        if (op === 'and' || op === 'or') {
            const left = lowerNum(compiled.left, lines);
            if (!left) return undefined;
            const res = `v${serial++}`, guarded: string[] = [];
            const right = lowerNum(compiled.right, guarded);
            if (!right) return undefined;
            lines.push(`let ${res} = ${left}; if (${op === 'and' ? '' : '!'}${res}) { ${guarded.join('\n')} ${res} = ${right}; }`);
            return res;
        }
        // A residue can stay exact even when the full product cannot. Only
        // fuse the expression itself; stored ordinary bindings remain exact.
        let product = compiled.left;
        while (product.kind === 'group') product = product.operand;
        if (op === 'mod' && compiled.signature.result === 'integer'
            && product.kind === 'binary' && product.operation.name === '*'
            && product.signature.result === 'integer') {
            const a = lowerNum(product.left, lines), b = lowerNum(product.right, lines);
            const modulus = lowerNum(compiled.right, lines);
            if (!a || !b || !modulus) return undefined;
            const result = `v${serial++}`;
            lines.push(`const ${result} = mulmod(${a}, ${b}, ${modulus});`);
            return result;
        }
        const left = lowerNum(compiled.left, lines), right = lowerNum(compiled.right, lines);
        if (!left || !right) return undefined;
        if (typeof compiled.signature.result !== 'string') return undefined;
        return binaryNumber(compiled.operation, left, right, lines, compiled.signature.result);
    }
    function binaryNumber(operation: CompiledOperator, left: string, right: string,
        lines: string[], type: CompiledScalarType): string | undefined {
        const op = operation.name;
        const res = `v${serial++}`;
        if (op === '+' || op === '-' || op === '*') {
            const isInteger = type === 'integer';
            const calc = `(${left}) ${operation.binary} (${right})`;
            lines.push(`const ${res} = ${isInteger ? `safe(${calc})` : calc};`);
        } else if (op === '/' || op === '//' || op === 'mod' || op === '**') {
            if (op === '/') {
                lines.push(`if (${right} === 0) throw zero();`);
                lines.push(`const ${res} = (${left}) / (${right});`);
            } else if (op === '//' || op === 'mod') {
                lines.push(`if (${right} === 0) throw zero();`);
                const remainder = `v${serial++}`;
                // As in Number loops, |a| < 2^52 cannot round a/b across
                // an integer. Keep the remainder path for wider numerators.
                if (op === '//') lines.push(`let ${res}; if (Math.abs(${left}) < 4503599627370496) { ${res} = Math.floor((${left}) / (${right})) || 0; } else {`);
                lines.push(`const ${remainder} = (${left}) % (${right});`);
                lines.push(`${op === '//' ? '' : 'const '}${res} = ${binaryOperatorSource(operation, left, right, { number: true, remainder, safe: s => `safe(${s})` })};`);
                if (op === '//') lines.push('}');
            } else if (op === '**') {
                lines.push(`if (${zeroTestSource(left, 'numeric')} && (${right}) < 0) throw powerZero();`);
                const isInteger = type === 'integer';
                lines.push(`const ${res} = ${isInteger ? `power(${left}, ${right})` : `(${left}) ** (${right})`};`);
                if (!isInteger) lines.push(`if (Number.isNaN(${res})) throw powerDomain();`);
            }
        } else if (['<', '<=', '>', '>=', '==', '!=', 'equal', 'notequal'].includes(op) || operation.binary) {
            lines.push(`const ${res} = (${left}) ${operation.binary} (${right});`);
        } else return undefined;
        return res;
    }

    function numberPlan(consumer: FunctionPlanConsumer, lines: string[]): string | undefined {
        const seen = new Set<FunctionPlan>();
        function supported(node: FunctionPlan): boolean {
            if (seen.has(node)) return true;
            seen.add(node);
            if (!['integer', 'boolean'].includes(node.type.element)) return false;
            if (node.kind === 'literal') return typeof node.value !== 'bigint' || Number.isSafeInteger(Number(node.value));
            if (node.kind === 'group' || node.kind === 'unary') return supported(node.operand);
            if (node.kind === 'binary') return supported(node.left) && supported(node.right);
            if (node.kind === 'extreme') return !!node.right && supported(node.left) && supported(node.right);
            if (node.kind !== 'input') return false;
            const input = node.input;
            if (input.map || input.native || input.conversion || input.power) return false;
            if (input.name) return !node.type.rank || node.type.rank === 1 && arrays.has(input.name);
            return [input.stage, input.operand, ...input.vector ?? [], input.outer?.left,
                input.outer?.right, input.reduction?.operand, input.length, input.gather?.source, input.gather?.indices]
                .filter((value): value is FunctionPlan => !!value).every(supported);
        }
        if (!['sum', 'product'].includes(consumer.terminal) || !supported(consumer.stage)) return undefined;
        const unavailable = Symbol();
        try {
            return emitFunctionPlan(consumer, lines, {
                number: true, variable: () => `v${serial++}`, slot,
                check: (value, type) => type === 'integer' ? `safe(${value})` : value,
                array: name => ({ size: `${cells(name)}.length`, read: index => {
                    const value = `${cells(name)}[${index}]`;
                    return borrowedArrays.has(name) ? `safe(Number(${value}))` : value;
                } }),
                locate: (_source, body, demand) => body.push(`location = ${demand};`),
                locateShape: (source, body) => {
                    const location = locations.indexOf(source);
                    if (location < 0) throw unavailable;
                    body.push(`location = ${location};`);
                },
                capture: () => { throw unavailable; }, callback: () => { throw unavailable; },
                binary: (op, left, right, body, type) => {
                    const value = binaryNumber(op, left, right, body, type);
                    if (value === undefined) throw unavailable;
                    return value;
                },
            });
        } catch (error) {
            if (error === unavailable) return undefined;
            throw error;
        }
    }

    function lowerCommands(statements: readonly Statement[], lines: string[]): boolean {
        for (const cmd of statements) {
            const loc = locations.indexOf(cmd);
            lines.push(`location = ${loc};`);
            if (isReturnStatement(cmd)) {
                if (!cmd.value) { lines.push('return undefined;'); continue; }
                const body = proof.planReturns.has(cmd) ? [] : lines;
                if (vectorResult) {
                    const vector = vectorOperands(proof.expressions.get(cmd.value)!)!;
                    const values: string[] = [];
                    for (const [index, operand] of vector.indices!.entries()) {
                        const value = lowerNum(operand, body);
                        if (value === undefined) return false;
                        values.push(`safe(${vector.signs?.[index] ? '-' : ''}(${value}))`);
                    }
                    body.push(`return integerVector([${values.join(',')}]);`);
                    continue;
                }
                const val = emitNum(cmd.value, body);
                if (!val) return false;
                body.push(`return ${proof.type === 'integer' ? `safe(${val})` : val};`);
                if (body !== lines) {
                    const origin = locations.indexOf(cmd.value);
                    lines.push(`try { location = ${origin}; ${body.join('\n')} } catch (error) {
                        if (error === overflow) throw error;
                        if (!(error instanceof RankError)) throw error;
                        throw new FunctionPlanDemandError(locate(error, location));
                    }`);
                }
            } else if (isExpressionStatement(cmd)) {
                if (!emitNum(cmd.value, lines)) return false;
            } else if (isArrayAssignmentStatement(cmd)) {
                if (!arrays.has(cmd.name) || cmd.indices.length !== 1 || !cmd.indices[0].value
                    || !['=', '+=', '-=', '*='].includes(cmd.operator)) return false;
                const coordinate = emitNum(cmd.indices[0].value, lines);
                if (!coordinate) return false;
                const at = index(cells(cmd.name), coordinate, lines);
                let value = emitNum(cmd.value, lines);
                if (!value) return false;
                if (cmd.operator !== '=') value = `${cells(cmd.name)}[${at}] ${cmd.operator[0]} (${value})`;
                // The proof requires matching RHS and destination element
                // domains. Integer compound writes still replay on overflow;
                // real writes retain their IEEE values.
                if (proof.expressions.get(cmd.value)?.type === 'integer') value = `safe(${value})`;
                if (cowArrays.has(cmd.name)) {
                    const next = `v${serial++}`;
                    lines.push(`const ${next} = ${value}; ${slot(cmd.name)}.writable(); ${slot(cmd.name)}.store(${at}, ${next});`);
                } else lines.push(`${slot(cmd.name)}[${at}] = ${value};`);
            } else if (isPushStatement(cmd)) {
                if (!isNameExpression(cmd.receiver) || !queues.has(cmd.receiver.name)) return false;
                const value = emitNum(cmd.value, lines);
                if (!value) return false;
                // This JS-vector capacity guard falls back to Rank's queue.
                lines.push(`if (${slot(cmd.receiver.name)}.length >= 0xffffffff) throw overflow;
                    ${slot(cmd.receiver.name)}[${slot(cmd.receiver.name)}.length] = safe(${value});`);
            } else if (isAssignmentStatement(cmd)) {
                if (proof.planBindings.has(cmd)) continue;
                if (arrays.has(cmd.name) || queues.has(cmd.name)) {
                    const value = proof.expressions.get(cmd.value);
                    if (cmd.operator !== '=' || !(arrays.has(cmd.name) ? arrayBinding(value)
                        : inputOf(value)?.input.operation === 'new')) return false;
                }
                const input = inputOf(proof.expressions.get(cmd.value))?.input;
                let val = cowArrays.has(cmd.name) && input && !input.operation && !input.indices
                    ? `${slot(input.name)}.fork()` : emitNum(cmd.value, lines);
                if (!val) return false;
                if (cowArrays.has(cmd.name)) {
                    const next = `v${serial++}`;
                    lines.push(`const ${next} = ${val}; ${slot(cmd.name)}?.release(); ${slot(cmd.name)} = ${next};`);
                    continue;
                }
                if (cmd.operator !== '=') {
                    const op = findCompiledOperator(cmd.operator.slice(0, -1));
                    if (!op) return false;
                    const prev = slot(cmd.name);
                    let calc: string;
                    if (['+', '-', '*'].includes(op.name)) calc = `(${prev}) ${op.binary} (${val})`;
                    else if (op.name === '/' || op.name === '//' || op.name === 'mod') {
                        lines.push(`if (${val} === 0) throw zero();`);
                        if (op.name === 'mod') {
                            const remainder = `v${serial++}`;
                            lines.push(`const ${remainder} = (${prev}) % (${val});`);
                            calc = binaryOperatorSource(op, prev, val, { number: true, remainder, safe: value => `safe(${value})` });
                        } else calc = op.name === '//' ? `Math.floor((${prev}) / (${val}))` : `(${prev}) / (${val})`;
                    } else return false;
                    val = proof.expressions.get(cmd.value)?.type === 'integer' ? `safe(${calc})` : calc;
                } else if (proof.expressions.get(cmd.value)?.type === 'integer') {
                    val = `safe(${val})`;
                }
                lines.push(`${slot(cmd.name)} = ${val};`);
            } else if (isIfStatement(cmd)) {
                const branches = [{ condition: cmd.condition, statements: cmd.thenStatements }, ...cmd.elifClauses];
                for (const branch of branches) {
                    const cond = emitNum(branch.condition, lines);
                    if (!cond) return false;
                    lines.push(`if (${cond}) {`);
                    if (!lowerCommands(branch.statements, lines)) return false;
                    lines.push('} else {');
                }
                if (!lowerCommands(cmd.elseStatements, lines)) return false;
                lines.push('}'.repeat(branches.length));
            } else if (isForStatement(cmd)) {
                const binding = forIteration(cmd.condition);
                if (binding && binding.names.length <= 2 && binding.names.every(name => !name.includes('.'))) {
                    let receiver = binding.iterable;
                    while (isParenthesizedExpression(receiver)) receiver = receiver.value;
                    if (isNameExpression(receiver) && (queues.has(receiver.name) || arrays.has(receiver.name))) {
                        const source = `source${serial++}`, cursor = `cursor${serial++}`;
                        // Capture the receiver once. Both its cell updates and
                        // queue appends remain live; rebinding changes no iterator.
                        lines.push(`{ const ${source} = ${slot(receiver.name)}${cowArrays.has(receiver.name) ? '\.readView()' : ''};
                            for (let ${cursor} = 0; ${cursor} < ${source}.length; ${cursor}++) { location = ${loc}; checkpoint();`);
                        if (binding.names[0] !== '#') {
                            const cell = cowArrays.has(receiver.name) ? `${source}.read(${cursor})` : `${source}[${cursor}]`;
                            const borrowed = borrowedArrays.has(receiver.name);
                            lines.push(`let ${slot(binding.names[0])} = ${borrowed ? `safe(Number(${cell}))` : cell};`);
                        }
                        if (binding.names[1] && binding.names[1] !== '#') lines.push(`let ${slot(binding.names[1])} = ${cursor};`);
                        if (!lowerCommands(cmd.statements, lines)) return false;
                        lines.push('}}');
                        continue;
                    }
                }
                if (binding && binding.iterable && binding.names.length === 1 && !binding.names[0].includes('.')) {
                    let rangeExpr = binding.iterable;
                    while (isParenthesizedExpression(rangeExpr)) rangeExpr = rangeExpr.value;
                    const range = rangeSliceOperands(rangeExpr);
                    // A slice iterates cells of its receiver, not the bounds.
                    // Keep its existing exact/prefix path until lowered here.
                    if (range) return false;
                    if (isBinaryExpression(rangeExpr) && (rangeExpr.operator === 'to' || rangeExpr.operator === 'till')) {
                        const start = emitNum(rangeExpr.left, lines);
                        const end = emitNum(rangeExpr.right, lines);
                        const step = rangeExpr.step ? emitNum(rangeExpr.step, lines) : '1';
                        if (!start || !end || !step) return false;
                        const induction = slot(binding.names[0]);
                        const startVar = `start${serial++}`, endVar = `end${serial++}`, stepVar = `step${serial++}`, cursor = `cursor${serial++}`;
                        const cmp = rangeExpr.operator === 'to' ? '<=' : '<';
                        lines.push(`const ${startVar} = ${start}, ${endVar} = ${end}, ${stepVar} = ${step};`);
                        if (narrowMembership) {
                            // Include the terminal increment, also for descending
                            // and exclusive ranges. The iterator itself never wraps.
                            for (const value of [startVar, endVar, stepVar, `${endVar} + ${stepVar}`]) {
                                lines.push(`if ((${value}) !== ((${value}) | 0)) throw overflow;`);
                            }
                        }
                        lines.push(`if (${stepVar} === 0) throw badStep();`);
                        // The cursor belongs to the iterator, independently of
                        // assignments to its block-local iteration binding.
                        lines.push(`for (let ${cursor} = ${startVar}; ${stepVar} > 0 ? ${cursor} ${cmp} ${endVar} : ${cursor} ${rangeExpr.operator === 'to' ? '>=' : '>'} ${endVar}; ${cursor} = safe(${cursor} + ${stepVar})) { location = ${loc}; checkpoint(); let ${induction} = ${narrowMembership ? `${cursor} | 0` : cursor};`);
                        if (!lowerCommands(cmd.statements, lines)) return false;
                        lines.push('}');
                        continue;
                    }
                    return false;
                }
                if (!binding && cmd.condition) {
                    lines.push('for (;;) { checkpoint();');
                    const cond = emitNum(cmd.condition, lines);
                    if (!cond) return false;
                    lines.push(`if (!(${cond})) break;`);
                    if (!lowerCommands(cmd.statements, lines)) return false;
                    lines.push('}');
                } else {
                    return false;
                }
            } else if (isBreakStatement(cmd)) {
                lines.push('break;');
            } else if (isContinueStatement(cmd)) {
                lines.push('continue;');
            } else {
                return false;
            }
        }
        return true;
    }

    const lines: string[] = [];
    if (!lowerCommands(statement.statements, lines)) return undefined;
    const paramNames = statement.parameters.map((_, i) => `r${i}`);
    const localSlots = [...slots.values()].filter(i => i >= statement.parameters.length).map(i => `r${i}`);
    const narrowParameters = narrowMembership ? statement.parameters.flatMap((name, index) => parameterTypes[index] === 'integer'
        ? [`if (${slot(name)} !== (${slot(name)} | 0)) throw overflow; ${slot(name)} |= 0;`] : []) : [];
    const source = `"use strict"; return function(locate, safe, zero, overflow, checkpoint, power, badStep, powerZero, powerDomain, memberships, users, planConsumed) {
        return function(${paramNames.join(',')}) {
            ${localSlots.length ? `let ${localSlots.join(',')};` : ''}
            let location = -1;
            try { ${vectorResult ? 'if (!vectorAllowed()) throw overflow;' : ''} ${narrowParameters.join('\n')} ${lines.join('\n')} } catch (error) { throw locate(error, location); }
        };
    };`;
    try {
        return new Function('isqrt', 'mulmod', 'PrivateNumericArray', 'broadcastShape', 'RankError', 'FunctionPlanDemandError', 'gcd', 'powmod', 'integerVector', 'vectorAllowed', source)(safeIntegerSquareRoot, checkedNumberModularMultiply, PrivateNumericArray, broadcastShape, RankError, FunctionPlanDemandError,
            (left: number, right: number) => {
                if (!privateLoopPolling() || demandBudgetEnabled()) throw numberOverflow;
                checkpoint('computing numbers');
                return safeIntegerGcd(left, right);
            },
            (base: number, exponent: number, modulus: number) => {
                // Replay through the ordinary native call for domain errors,
                // wider moduli, and observable budget/cancellation boundaries.
                if (!privateLoopPolling() || demandBudgetEnabled() || exponent < 0 || !(modulus > 0 && modulus <= 2 ** 31)) throw numberOverflow;
                return safeIntegerModularPower(base, exponent, modulus);
            }, (items: number[]) => ownedArray(items.map(BigInt), [items.length], true),
                () => privateLoopPolling() && !demandBudgetEnabled()) as Kernel['numberDirect'];
    } catch {
        return undefined;
    }
}

// Callers prove the selected argument types and private local assignments before binding.
// The kernel has no environment access; cached code retains only syntax metadata.
export function compileScalarFunction(statement: FunctionStatement, parameterTypes?: readonly CompiledCalleeType[], loops = false, capturedTypes?: ScalarCaptureTypes): Kernel | undefined {
    const proof = scalarFunctionResult(statement, true, parameterTypes, loops, [], capturedTypes);
    if (!proof) return undefined;
    if (kernels.has(proof)) return kernels.get(proof) ?? recordFallback('scalar-function:code-generation');
    const expressions = proof.expressions;
    // Constructor-only scratch arrays cannot leave stale aliases. Preserve
    // their cheaper binding bookkeeping; count scopes only when a
    // parameter, alias, unpack or returned array can benefit from retirement.
    const arrayType = (type: CompiledCalleeType | undefined) => type !== undefined
        && typeof type !== 'string' && !isCompiledContainer(type);
    const scopedArrays = !!proof.arrayWrites.size && (!proof.localArrayWrites
        || parameterTypes?.some(arrayType) || arrayType(proof.type)
        || AstUtils.streamAllContents(statement).some(node => isUnpackStatement(node)
            || isAssignmentStatement(node) && arrayType(expressions.get(node.value)?.type)
                && !isArrayExpression(node.value)));

    // Guarded captures cannot change when assignments are local, polling is
    // private, and the invocation makes no native or nested user calls.
    const stableCaptures = !proof.callCount && !proof.observableCaptures
        && ![...expressions.values()].some(expression => expression.kind === 'call'
            || expression.kind === 'binary' && typeof expression.signature.result !== 'string'
            || expression.kind === 'input' && ['materialize-iterable', 'array-native', 'reshape', 'range-array'].includes(expression.input.operation ?? ''));
    const slots = new Map<string, number>();
    const slot = (name: string): string => {
        if (!slots.has(name)) slots.set(name, slots.size);
        return `r${slots.get(name)}`;
    };
    const arrayBinding = (name: string) => scopedArrays
        ? `bindings.bind(${slots.get(name)}, ${slot(name)})` : `noteArrayBinding(${slot(name)})`;
    statement.parameters.forEach(slot);
    const locations: (Statement | Expression)[] = [];
    const calls: { operation: Operation; inputs: readonly string[]; native?: boolean; capturedArgument?: string; bound?: 'to' | 'till' }[] = [];
    const userCalls: { name: string; statement: FunctionStatement; types: readonly CompiledCalleeType[]; locals: readonly string[]; tail: boolean; recursive?: boolean; captures?: ScalarCaptureTypes }[] = [];
    const scalarCaptures: { name: string; type: CompiledScalarType }[] = [];
    const memberships: string[] = [];
    const captures: { name: string; rank: number }[] = [];
    const writtenSlots = new Set([...proof.arrayWrites].filter(isArrayAssignmentStatement).map(command => command.name));
    let serial = 0, deques = false, setMembership = false;
    function binary(operation: CompiledOperator, left: string, right: string, lines: string[], resultType?: CompiledCalleeType, inputs?: readonly CompiledCalleeType[]): string {
        const op = operation.name;
        const result = `v${serial++}`;
        if ((op === 'equal' || op === 'notequal') && inputs?.includes('integer') && inputs.includes('real')) {
            lines.push(`const ${result} = ${binaryOperatorSource(operation, left, right, { mixed: true })};`);
        } else if (op === '/' || op === '**') {
            if (op === '/') lines.push(`if (${zeroTestSource(right, 'numeric')}) throw new RankError('division by zero');`);
            else lines.push(`if (${zeroTestSource(left, 'numeric')} && (${right}) < 0) throw new RankError('zero cannot be raised to a negative power');`);
            lines.push(`const ${result} = ${binaryOperatorSource(operation, `Number(${left})`, `Number(${right})`)};`);
            if (op === '**') lines.push(`if (Number.isNaN(${result})) throw new RankError('power result is not real');`);
        } else if (resultType === 'real' && (op === '+' || op === '-' || op === '*')) {
            lines.push(`const ${result} = ${binaryOperatorSource(operation, `Number(${left})`, `Number(${right})`)};`);
        } else if (op === '//' || op === 'mod') {
            const remainder = op === 'mod' ? `v${serial++}` : undefined;
            lines.push(`if (${zeroTestSource(right, 'integer')}) throw new RankError('division by zero');`);
            if (remainder) lines.push(`const ${remainder} = ${left} % ${right};`);
            lines.push(`const ${result} = ${binaryOperatorSource(operation, left, right, { remainder })};`);
        } else lines.push(`const ${result} = ${binaryOperatorSource(operation, left, right)};`);
        return result;
    }
    function emitPlan(consumer: FunctionPlanConsumer, lines: string[], origin?: Expression, captured = false): string {
        return emitFunctionPlan(consumer, lines, {
            variable: () => `v${serial++}`, slot, binary,
            // Cell computation belongs to the consumer. Shape validation
            // still belongs to construction of the deferred expression.
            locate: (source, body, demandLocation) => {
                if (['sum', 'product'].includes(consumer.terminal) && consumer.stage.type.rank) {
                    body.push(`location = ${origin ? locations.push(origin) - 1 : demandLocation};`);
                    return;
                }
                let owner = source.$container;
                while (owner && !isAssignmentStatement(owner)) owner = owner.$container;
                body.push(`location = ${owner && isAssignmentStatement(owner) && owner.deferred ? locations.push(origin ?? source) - 1 : demandLocation};`);
            },
            locateShape: (source, body, demandLocation) => {
                let owner = source.$container;
                while (owner && !isAssignmentStatement(owner)) owner = owner.$container;
                body.push(`location = ${owner && isAssignmentStatement(owner) && owner.deferred ? locations.push(origin ?? source) - 1 : demandLocation};`);
            },
            capture: (key, body) => { if (!captured) body.push(`mappedCalls[${key}] = rankedCalls[${key}]();`); },
            callback: (key, value, body) => {
                const result = `v${serial++}`;
                body.push(`const ${result} = mappedCalls[${key}]([${value}]);`);
                return result;
            },
        });
    }
    function iterable(source: ScalarLoopIterable, lines: string[]): string {
        if (source.kind === 'group') {
            const key = lower(source.key,lines), result = `v${serial++}`;
            lines.push(`const ${result} = ${slot(source.receiver)}.valuesAt(${key});`);
            return result;
        }
        if (source.kind === 'literal') return emit(source.expression, lines);
        const argument = source.argument ? emitPlan({stage: source.argument, terminal: 'copy'}, lines, 'kind' in source.source ? undefined : source.source)
            : 'kind' in source.source ? iterable(source.source, lines) : emit(source.source, lines);
        const index = calls.push({ operation: source.operation, inputs: [], native: true }) - 1;
        const result = `v${serial++}`;
        if (source.deferred) lines.push(`location = ${locations.push(source.origin) - 1};`);
        lines.push(`const ${result} = calls[${index}](${argument});`);
        return result;
    }
    function emit(expression: Expression, lines: string[], tail = false): string {
        return lower(expressions.get(expression)!, lines, tail);
    }
    function lower(expression: CompiledExpression<CompiledCalleeType, ScalarFunctionInput>, lines: string[], tail = false, selection?: { name: string; count: number }): string {
        if (expression.kind === 'group') return lower(expression.operand, lines, tail);
        if (expression.kind === 'literal') return typeof expression.value === 'bigint'
            ? `${expression.value}n` : typeof expression.value === 'number'
                ? Object.is(expression.value, -0) ? '-0' : String(expression.value) : JSON.stringify(expression.value);
        if (expression.kind === 'input') {
            const operation = expression.input.operation;
            if (operation === 'choose') {
                const values = expression.input.indices!.map(operand => {
                    const value = lower(operand, lines), name = `v${serial++}`;
                    lines.push(`const ${name} = ${value};`);
                    return name;
                });
                const result = `v${serial++}`;
                lines.push(`const ${result} = ${values[0]} ? ${values[1]} : ${values[2]};`);
                return result;
            }
            if (operation === 'gather' || operation === 'compare-array') {
                const values = expression.input.indices!.map(input => lower(input, lines)), result = `v${serial++}`;
                lines.push(`const ${result} = ${operation === 'gather' ? `applySelectors([${slot(expression.input.name)}, ${values[0]}])`
                    : `compareCells(${JSON.stringify(expression.input.name)}, ${values[0]}, ${values[1]})`};`);
                return result;
            }
            if (operation === 'text-at') {
                const index = lower(expression.input.indices![0], lines), result = `v${serial++}`;
                lines.push(`const ${result} = textAt(${slot(expression.input.name)}, ${index});`);
                return result;
            }
            if (operation === 'integer-power') {
                const [left, right] = expression.input.indices!.map(input => lower(input, lines));
                const result = `v${serial++}`;
                lines.push(`const ${result} = ${expression.input.negative ? '-' : ''}((${left}) ** (${right}));`);
                return result;
            }
            if (operation === 'array-power') {
                const values = expression.input.indices!.map(input => lower(input, lines)), result = `v${serial++}`;
                lines.push(`const ${result} = arrayBinary('**', ${values.join(',')});`);
                return expression.input.negative ? `arrayBinary('*', -1n, ${result})` : result;
            }
            if (operation === 'stack') {
                const values = expression.input.indices!.map(input => lower(input, lines)), result = `v${serial++}`;
                lines.push(`const ${result} = stackValues([${values.join(',')}], ${expression.input.axis});`);
                return result;
            }
            if (operation === 'fold') {
                const [source, seed] = expression.input.indices!.map(input => lower(input, lines));
                const callee = expression.input.callee!;
                const key = userCalls.push({ name: expression.input.name, statement: callee.statement, types: callee.types,
                    locals: callee.proof.locals, tail: false, captures: callee.captures }) - 1;
                const cells = `v${serial++}`, size = `v${serial++}`, index = `v${serial++}`, state = `v${serial++}`;
                lines.push(`noteFold(); const ${cells} = tensorCells(${source}, [0]); const ${size} = ${source}.shape[0]; let ${state} = ${seed};`);
                lines.push(`for (let ${index} = 0; ${index} < ${size}; ${index}++) {
                    checkpoint('reducing input cells');
                    const row = ${cells}.cellAt(${index});
                    ${state} = userCalls[${key}](materializeValue(${state}), materializeValue(row));
                }`);
                return state;
            }
            if (operation === 'range-array') {
                const values = expression.input.indices!.map(input => lower(input, lines)), result = `v${serial++}`;
                lines.push(`const ${result} = materializeArray(makeRange(${values[0]}, ${values[1]}, ${expression.input.name === 'to'}, ${values[2] ?? 'undefined'}));`);
                return result;
            }
            if (operation === 'reshape') {
                const source = lower(expression.input.indices![0], lines);
                const dimensions = expression.input.reshapeDimensions!.map(dimension => dimension ? lower(dimension, lines) : 'undefined');
                const result = `v${serial++}`;
                lines.push(`const ${result} = reshapeWithDimensions(${source}, [${dimensions.join(',')}]);`);
                return result;
            }
            if (operation === 'array-native') {
                const values = expression.input.indices!.map(input => lower(input, lines)), result = `v${serial++}`;
                const index = calls.push({ operation: expression.input.native!, inputs: [], native: true }) - 1;
                lines.push(`const ${result} = calls[${index}](${values.join(',')});`);
                return result;
            }
            if (operation === 'materialize-iterable') {
                const source = iterable(expression.input.iterable!, lines), result = `v${serial++}`;
                lines.push(`const ${result} = materializeArray(${source});`);
                return result;
            }
            if (operation === 'plan') return emitPlan(expression.input.plan!, lines);
            if (operation === 'materialize-deque') {
                const value = lower(expression.input.indices![0], lines), result = `v${serial++}`;
                lines.push(`const ${result} = materializeCollection(${value});`);
                return result;
            }
            if (operation === 'sort' || operation === 'unique' || operation === 'argsort') {
                const value = lower(expression.input.indices![0],lines), result = `v${serial++}`;
                const call = operation === 'sort' ? 'sortValue' : operation === 'unique' ? 'uniqueValue' : 'argsortValue';
                lines.push(`const ${result} = ${call}(${value});`);
                return result;
            }
            if (operation === 'take' || operation === 'drop' || operation === 'copy') {
                const values = expression.input.indices!.map(item => lower(item, lines));
                const result = `v${serial++}`;
                lines.push(`const ${result} = ${operation === 'copy' ? `copyArray(${values[0]})`
                    : `takeDropValue(${values[0]}, ${values[1]}, ${operation === 'drop'})`};`);
                return result;
            }
            if (operation === 'vector') {
                const values = expression.input.indices!.map((item, index) => {
                    const value = lower(item, lines);
                    return expression.input.signs?.[index] ? `-(${value})` : value;
                });
                const result = `v${serial++}`;
                lines.push(`const ${result} = ownedArray([${values.join(',')}], [${values.length}], true);`);
                return result;
            }
            if (operation === 'user-call' || operation === 'self-call') {
                const callee = expression.input.callee;
                // Construct every argument before the strict parameter
                // boundary completes arrays, matching the ordinary binder.
                const values = expression.input.indices!.map(argument => lower(argument, lines));
                const arguments_ = values.map((value, index) => {
                    const domain = expression.input.indices![index].type;
                    if (typeof domain === 'string' || isCompiledContainer(domain)) return value;
                    const completed = `v${serial++}`;
                    lines.push(`const ${completed} = completeArgument(${value});`);
                    return completed;
                });
                const index = userCalls.push({ name: expression.input.name, statement: callee?.statement ?? statement,
                    types: callee?.types ?? expression.input.indices!.map(argument => argument.type),
                    locals: callee?.proof.locals ?? proof!.locals, tail, recursive: operation === 'self-call', captures: callee?.captures }) - 1;
                const result = `v${serial++}`;
                lines.push(tail
                    ? `const ${result} = userCalls[${index}]([${arguments_.join(',')}], true);`
                    : `const ${result} = userCalls[${index}](${arguments_.join(',')});`);
                return result;
            }
            if (operation === 'sequence-contains' || operation === 'sequence-not-contains') {
                const value = lower(expression.input.indices![0], lines);
                const index = memberships.push(expression.input.name) - 1, result = `v${serial++}`;
                lines.push(`const ${result} = ${operation === 'sequence-not-contains' ? '!' : ''}memberships[${index}](${value});`);
                return result;
            }
            if (operation === 'captured-scalar') {
                let index = scalarCaptures.findIndex(capture => capture.name === expression.input.name);
                if (index < 0) index = scalarCaptures.push({ name: expression.input.name, type: expression.type as CompiledScalarType }) - 1;
                const result = `v${serial++}`;
                lines.push(`const ${result} = ${stableCaptures ? `scalarValues[${index}]` : `scalars[${index}]()`};`);
                return result;
            }
            if (operation === 'captured-read') {
                const indices = expression.input.indices!.map(index => lower(index, lines));
                const index = captures.push({ name: expression.input.name, rank: indices.length }) - 1, result = `v${serial++}`;
                lines.push(selection ? `let ${result}; try { ${result} = captures[${index}]([${indices.join(',')}]); }
                    catch (error) { throw argumentSelectionError(error, ${JSON.stringify(selection.name)}, ${selection.count}); }`
                    : `const ${result} = captures[${index}]([${indices.join(',')}]);`);
                return result;
            }
            if (operation === 'concat' || operation === 'concat-copy') {
                const values = expression.input.indices!.map(input => lower(input, lines)), result = `v${serial++}`;
                lines.push(`const ${result} = ${operation === 'concat-copy' ? 'concatCopy' : 'concatValues'}([${values.join(',')}]);`);
                return result;
            }
            if (operation === 'captured-bound-len') {
                const limit = lower(expression.input.indices![0], lines);
                const index = calls.push({ operation: findOperation('len')!, inputs: ['sized'],
                    capturedArgument: expression.input.name, bound: expression.input.negative ? 'till' : 'to' }) - 1;
                const result = `v${serial++}`;
                lines.push(`const ${result} = calls[${index}](${limit});`);
                return result;
            }
            if (operation === 'captured-len') {
                const index = calls.push({ operation: findOperation('len')!, inputs: ['sized'], capturedArgument: expression.input.name }) - 1;
                const result = `v${serial++}`;
                // Resolve only when this expression executes, not at entry.
                // The native size protocol never asks arrays for their cells.
                lines.push(`const ${result} = calls[${index}]();`);
                return result;
            }
            const receiver = slot(expression.input.name);
            if (operation === 'array-len') {
                const result = `v${serial++}`;
                lines.push(`const ${result} = BigInt(${receiver}.shape[0] ?? 0);`);
                return result;
            }
            if (operation === 'array-contains' || operation === 'array-not-contains') {
                const value = lower(expression.input.indices![0], lines);
                const result = `v${serial++}`;
                lines.push(`const ${result} = ${operation === 'array-not-contains' ? '!' : ''}membershipLookup(${receiver})(${value});`);
                return result;
            }
            if (operation === 'set-contains' || operation === 'set-not-contains') {
                setMembership = true;
                const value = lower(expression.input.indices![0], lines), result = `v${serial++}`;
                lines.push(`const ${result} = ${operation === 'set-not-contains' ? '!' : ''}setHas(${receiver}, ${value});`);
                return result;
            }
            if (operation === 'array') {
                const dimensions = expression.input.dimensions!.map(({ value, negative }) => {
                    const size = lower(value, lines), result = `v${serial++}`;
                    lines.push(`const ${result} = checkedArrayDimension(${negative ? `-(${size})` : size});`);
                    return result;
                });
                const shape = `v${serial++}`, result = `v${serial++}`;
                lines.push(`const ${shape} = [${dimensions.join(',')}];`);
                const fill = lower(expression.input.indices![0], lines);
                lines.push(`const ${result} = ownedArray(Array(Number(${shape}.reduce((a, b) => a * BigInt(b), 1n))).fill(${fill}), ${shape}, true);`);
                return result;
            }
            if (operation === 'index-default') {
                const key = lower(expression.input.indices![0], lines), result = `v${serial++}`, fallback: string[] = [];
                const value = lower(expression.input.indices![1], fallback);
                lines.push(`let ${result} = indexGet(${receiver}, indexKey([${key}]));
                    if (${result} === undefined) { ${fallback.join('\n')} ${result} = ${value}; }`);
                return result;
            }
            if (operation) {
                const arguments_ = expression.input.indices?.map(index => lower(index, lines)) ?? [];
                const result = `v${serial++}`;
                // Local queues can invoke observable overridden methods too.
                if (typeof expression.type !== 'string' && expression.type.kind === 'deque'
                    || operation === 'pop') deques = true;
                const code = operation === 'new' ? `newStructure(${JSON.stringify(expression.input.name)})`
                    : operation === 'pop' ? `${receiver}.pop()`
                    : operation === 'len' ? `BigInt(${receiver}.kind === 'index' ? ${receiver}.entries.size : ${receiver}.size)`
                    : `${operation === 'not-contains' ? '!' : ''}indexHas(${receiver}, indexKey([${arguments_.join(',')}]))`;
                lines.push(`const ${result} = ${code};`);
                return result;
            }
            if (!expression.input.indices) return receiver;
            const indices = expression.input.indices.map(index => lower(index, lines));
            const result = `v${serial++}`;
            const array = slot(expression.input.name), reader = `reader${slots.get(expression.input.name)}`;
            const read = expression.input.keyed ? `scalarSelection(${array}, [${indices.join(',')}])`
                : `(${reader} ??= prepareReader(${array}, ${indices.length}))(${indices.length <= 2 ? indices.join(',') : `[${indices.join(',')}]`})`;
            lines.push(selection ? `let ${result}; try { ${result} = ${read}; }
                catch (error) { throw argumentSelectionError(error, ${JSON.stringify(selection.name)}, ${selection.count}); }`
                : `const ${result} = ${read};`);
            return result;
        }
        if (expression.kind === 'extreme') {
            const left = lower(expression.left, lines, false, expression.selected ? { name: expression.name, count: expression.selected } : undefined);
            if (!expression.right) return left;
            const right = lower(expression.right, lines), result = `v${serial++}`;
            lines.push(`const ${result} = ${scalarExtremeSource(expression.name, left, right)};`);
            return result;
        }
        if (expression.kind === 'unary') {
            const value = lower(expression.operand, lines), result = `v${serial++}`;
            if (typeof expression.type !== 'string') return expression.operation.unary === '-'
                ? `arrayBinary('*', -1n, ${value})` : value;
            lines.push(`const ${result} = ${expression.operation.unary}(${value});`);
            return result;
        }
        if (expression.kind === 'call') {
            const arguments_ = expression.arguments.map(argument => lower(argument, lines));
            // Entry guards still check the bits binding. Exact BigInt operators
            // need no native call frame and cannot invoke user callbacks.
            const bitwise = { band: '&', bor: '|', bxor: '^' } as const;
            if (expression.operation.module === 'bits'
                && Object.prototype.hasOwnProperty.call(bitwise, expression.operation.name)
                && expression.arguments.length === 2 && expression.arguments.every(argument => argument.type === 'integer')) {
                const result = `v${serial++}`;
                lines.push(`const ${result} = ${arguments_[0]} ${bitwise[expression.operation.name as keyof typeof bitwise]} ${arguments_[1]};`);
                return result;
            }
            const index = calls.push({ operation: expression.operation, inputs: expression.arguments.map(({ type }) => typeof type === 'string' ? type
                : !isCompiledContainer(type) && (type.element === 'text' || type.element === 'integer') && type.rank === 1 ? `${type.element}-array` : 'array') }) - 1;
            const result = `v${serial++}`;
            lines.push(`const ${result} = calls[${index}](${arguments_.join(',')});`);
            return result;
        }
        const operator = expression.operation.name;
        if (typeof expression.signature.result !== 'string') {
            const left = lower(expression.left, lines), right = lower(expression.right, lines), result = `v${serial++}`;
            lines.push(`const ${result} = arrayBinary(${JSON.stringify(operator)}, ${left}, ${right});`);
            return result;
        }
        if (operator === 'and' || operator === 'or') {
            // The right side runs only when the left does not decide.
            const left = lower(expression.left, lines), result = `v${serial++}`, guarded: string[] = [];
            const right = lower(expression.right, guarded);
            lines.push(`let ${result} = ${left}; if (${operator === 'and' ? '' : '!'}${result}) { ${guarded.join('\n')} ${result} = ${right}; }`);
            return result;
        }
        const left = lower(expression.left, lines), right = lower(expression.right, lines);
        return binary(expression.operation, left, right, lines, expression.signature.result, expression.signature.inputs);
    }
    function commands(statements: readonly Statement[], lines: string[]): void {
        for (const command of statements) {
            const location = locations.push(command) - 1;
            lines.push(`location = ${location};`);
            if (isReturnStatement(command) && command.value) {
                let returned = expressions.get(command.value)!;
                while (returned.kind === 'group') returned = returned.operand;
                if (typeof returned.type !== 'string' && returned.kind === 'input' && returned.input.operation === 'plan'
                    && returned.input.plan?.terminal === 'copy') {
                    const consumer = returned.input.plan;
                    // A return retains a recipe when its inputs are plans or
                    // views. Capture callbacks and storage now, but perform
                    // shape/cell work only at the caller's demand boundary.
                    for (const key of functionPlanCallbacks(consumer.stage)) lines.push(`mappedCalls[${key}] = rankedCalls[${key}]();`);
                    const names = [...functionPlanArrays(consumer.stage)];
                    const inputs = names.map(name => slot(name));
                    for (const value of inputs) lines.push(`noteArrayBinding(${value});`);
                    const body: string[] = [], value = emitPlan({...consumer, terminal: 'view'}, body, undefined, true);
                    lines.push(`if (deferredArrayInputs([${inputs.join(',')}])) return returnedArrayPlan(new Map([${names.map(name => `[${JSON.stringify(name)}, ${slot(name)}]`).join(',')}]), () => { ${body.join('\n')} return ${value}; });`);
                    const eager = emitPlan({...consumer, terminal: 'view'}, lines, undefined, true);
                    lines.push(`return ${eager};`);
                    continue;
                }
                const body = proof!.planReturns.has(command) ? [] : lines;
                const value = emit(command.value, body, true);
                body.push(`return ${value};`);
                if (body !== lines) {
                    const origin = locations.push(command.value) - 1;
                    lines.push(`try { location = ${origin}; ${body.join('\n')} } catch (error) { if (!(error instanceof RankError)) throw error;
                        throw new FunctionPlanDemandError(locate(error, location)); }`);
                }
            } else if (isExpressionStatement(command)) {
                const mutation = applicationForm(command.value, findOperation, true);
                if (mutation.kind === 'collection-mutation' && mutation.operation === 'add' && isNameExpression(mutation.receiver)) {
                    const receiver = slot(mutation.receiver.name);
                    lines.push(`expectAddCollection(${receiver});`);
                    const value = emit(mutation.value, lines);
                    lines.push(`checkpoint('adding set element'); addToCollection(${receiver}, ${value});`);
                } else emit(command.value, lines);
            } else if (isAssignmentStatement(command)) {
                if (proof!.iterableBindings.has(command)) continue;
                // These immutable recipes have no work until their consumer.
                // Their captured slots cannot be rebound in an accepted proof.
                const stage = proof!.planBindings.get(command);
                if (stage) {
                    for (const key of functionPlanCallbacks(stage)) lines.push(`mappedCalls[${key}] = rankedCalls[${key}]();`);
                    for (const name of functionPlanArrays(stage)) lines.push(`noteArrayBinding(${slot(name)});`);
                    continue;
                }
                let value = emit(command.value, lines);
                if (command.operator !== '=') value = binary(findCompiledOperator(command.operator.slice(0, -1))!, slot(command.name), value, lines, expressions.get(command.value)!.type);
                // An ordinary local is a completion boundary just as in the
                // reference binder; typed array results may still be views.
                if (typeof expressions.get(command.value)!.type !== 'string') value = `materializeValue(${value})`;
                lines.push(`${slot(command.name)} = ${value};`);
                lines.push(`reader${slots.get(command.name)} = undefined;`);
                if (writtenSlots.has(command.name)) lines.push(`write${slots.get(command.name)} = undefined;`);
                if (proof!.arrayWrites.size && typeof expressions.get(command.value)!.type !== 'string') lines.push(`${arrayBinding(command.name)};`);
            } else if (isUnpackStatement(command)) {
                const value = emit(command.value, lines), unpacked = `v${serial++}`;
                lines.push(`const ${unpacked} = unpackApplicationItems(${value});`);
                lines.push(`if (${unpacked}.length !== ${command.names.length}) throw new RankError('unpack expects ${command.names.length} values, got ' + ${unpacked}.length);`);
                command.names.forEach((name, index) => {
                    if (name !== '#') {
                        lines.push(`${slot(name)} = ${unpacked}[${index}]; reader${slots.get(name)} = undefined;`);
                        if (proof!.arrayWrites.size) lines.push(`${arrayBinding(name)};`);
                    }
                });
            } else if (isBreakStatement(command)) lines.push('break;');
            else if (isContinueStatement(command)) lines.push('continue;');
            else if (isPushStatement(command) && isNameExpression(command.receiver)) {
                const value = emit(command.value, lines);
                lines.push(`${slot(command.receiver.name)}.push(${value});`);
            } else if (isArrayAssignmentStatement(command)) {
                const receiver = slot(command.name), writer = `write${slots.get(command.name)}`;
                if (proof!.arrayWrites.has(command)) lines.push(`if (!${writer}) writable(${receiver});`);
                const keys = command.indices.map(index => emit(index.value!, lines));
                const offset = `v${serial++}`;
                if (proof!.arrayWrites.has(command)) {
                    const coordinates = keys.map(key => {
                        const coordinate = `v${serial++}`;
                        lines.push(`const ${coordinate} = Number(${key});`);
                        return coordinate;
                    });
                    lines.push(`if (${keys.map((key, axis) => `${key} < 0n || ${coordinates[axis]} >= ${receiver}.shape[${axis}]`).join(' || ')}) scalarArrayWriteOffset(${receiver}, [${keys.join(',')}]);`);
                    lines.push(`const ${offset} = ${coordinates.reduce((offset, coordinate, axis) => axis ? `(${offset} * ${receiver}.shape[${axis}] + ${coordinate})` : coordinate, '')};`);
                }
                if (!proof!.arrayWrites.has(command)) lines.push(`const ${offset} = indexKey([${keys.join(',')}]); checkValueMutable(${receiver});`);
                let value = emit(command.value, lines);
                if (proof!.arrayWrites.has(command)) {
                    if (command.operator !== '=') {
                        const previous = `v${serial++}`;
                        lines.push(`const ${previous} = readArrayItem(${receiver}, ${offset});`);
                        value = binary(findCompiledOperator(command.operator.slice(0, -1))!, previous, value, lines, expressions.get(command.value)!.type);
                    }
                    const copy = `v${serial++}`;
                    lines.push(`const ${copy} = arrayForWrite(${receiver}, ${offset});
                        if (${copy}) { ${receiver} = ${copy}; ${arrayBinding(command.name)}; ${writer} = undefined; reader${slots.get(command.name)} = undefined; }
                        (${writer} ??= prepareWriter(${receiver}))(${offset}, ${value});`);
                } else {
                    if (command.operator !== '=') {
                        const previous = `v${serial++}`;
                        lines.push(`const ${previous} = indexRead(${receiver}, ${offset}, 'index key not found');`);
                        value = binary(findCompiledOperator(command.operator.slice(0, -1))!, previous, value, lines, 'integer');
                    }
                    lines.push(`indexSet(${receiver}, ${offset}, ${value});`);
                }
            } else if (isForStatement(command)) {
                const binding = forIteration(command.condition);
                lines.push('{');
                if (binding) {
                    let range = binding.iterable;
                    while (isParenthesizedExpression(range)) range = range.value;
                    const finite = proof!.loopIterables.get(command);
                    if (finite) {
                        const source = iterable(finite, lines), id = serial++;
                        const indexed = binding.names[1] !== undefined && binding.names[1] !== '#';
                        // Traversing a value is not an additional binding:
                        // ordinary array writes must remain visible to its iterator.
                        if (indexed) lines.push(`let ordinal${id} = 0n;`);
                        lines.push(`for (const point${id} of ${finite.kind === 'group' ? source : `loopValues(${source})`}) { location = ${location}; checkpoint();`);
                        binding.names.forEach((name, index) => {
                            if (name !== '#') lines.push(`${slot(name)} = ${index ? `ordinal${id}++` : `point${id}`};`);
                        });
                        commands(command.statements, lines);
                        lines.push('}}');
                        continue;
                    }
                    const iterableType = expressions.get(range)?.type;
                    const deque = iterableType && isCompiledContainer(iterableType) && iterableType.kind === 'deque';
                    if (iterableType === 'text' || deque) {
                        deques ||= !!deque;
                        const text = emit(range, lines), id = serial++;
                        const indexed = binding.names[1] !== undefined && binding.names[1] !== '#';
                        if (indexed) lines.push(`let ordinal${id} = 0n;`);
                        lines.push(`for (const point${id} of ${text}${deque ? '.values()' : ''}) { location = ${location}; checkpoint();`);
                        binding.names.forEach((name, index) => {
                            if (name !== '#') lines.push(`${slot(name)} = ${index ? `ordinal${id}++` : `point${id}`};`);
                        });
                        commands(command.statements, lines);
                        lines.push('}}');
                        continue;
                    }
                    if (!isBinaryExpression(range)) throw new Error('Unproved loop range');
                    const start = emit(range.left, lines), end = emit(range.right, lines);
                    const step = range.step ? emit(range.step, lines) : '1n';
                    const id = serial++;
                    const indexed = binding.names[1] !== undefined && binding.names[1] !== '#';
                    lines.push(`const start${id} = ${start}, end${id} = ${end}, step${id} = ${step};
                        if (step${id} === 0n) throw new RankError('range step must be a nonzero integer');`);
                    if (indexed) {
                        // Boxing a numeric ordinal on every iteration is slower than
                        // the existing BigInt induction; keep this variant exact.
                        lines.push(`for (let cursor${id} = start${id}, ordinal${id} = 0n;
                            step${id} > 0n ? cursor${id} ${range.operator === 'to' ? '<=' : '<'} end${id}
                                : cursor${id} ${range.operator === 'to' ? '>=' : '>'} end${id};
                            cursor${id} += step${id}, ordinal${id}++) {`);
                    } else {
                        // Guard the span and the terminating increment as well as
                        // the bounds. Body values remain exact Rank integers.
                        lines.push(`const from${id} = Number(start${id}), to${id} = Number(end${id}), by${id} = Number(step${id});
                            const narrow${id} = Number.isSafeInteger(from${id}) && Number.isSafeInteger(to${id})
                                && Number.isSafeInteger(by${id}) && Number.isSafeInteger(to${id} + by${id})
                                && Number.isSafeInteger(to${id} - from${id});
                            const limit${id} = narrow${id} ? to${id} : end${id}, stride${id} = narrow${id} ? by${id} : step${id};
                            for (let cursor${id} = narrow${id} ? from${id} : start${id};
                                stride${id} > 0 ? cursor${id} ${range.operator === 'to' ? '<=' : '<'} limit${id}
                                    : cursor${id} ${range.operator === 'to' ? '>=' : '>'} limit${id};
                                cursor${id} += stride${id}) {`);
                    }
                    lines.push(`location = ${location}; checkpoint();`);
                    binding.names.forEach((name, index) => {
                        if (name !== '#') lines.push(`${slot(name)} = ${indexed
                            ? `${index ? 'ordinal' : 'cursor'}${id}` : `narrow${id} ? BigInt(cursor${id}) : cursor${id}`};`);
                    });
                } else {
                    lines.push(`for (;;) { location = ${location}; checkpoint();`);
                    if (command.condition) {
                        const condition = emit(command.condition, lines);
                        lines.push(`if (!(${condition})) break;`);
                    }
                }
                commands(command.statements, lines);
                lines.push('}}');
            } else if (isIfStatement(command)) {
                const branches = [{ condition: command.condition, statements: command.thenStatements }, ...command.elifClauses];
                for (const branch of branches) {
                    lines.push(`location = ${location};`);
                    const condition = emit(branch.condition, lines);
                    lines.push(`if (${condition}) {`);
                    commands(branch.statements, lines);
                    lines.push('} else {');
                }
                commands(command.elseStatements, lines);
                lines.push('}'.repeat(branches.length));
            }
        }
    }
    const lines: string[] = [];
    commands(statement.statements, lines);
    const declarations = [...slots].map(([name, index]) => {
        const parameter = statement.parameters.lastIndexOf(name);
        return `r${index}${parameter >= 0 ? ` = args[${parameter}]` : ''}`;
    });
    const source = `"use strict"; return function(args, locate, calls, userCalls, memberships, captures, scalars, planConsumed, rankedCalls, poll) {
        const checkpoint = poll ?? kernelCheckpoint;
        ${proof.planCalls.length ? 'const mappedCalls = [];' : ''}
        ${stableCaptures && scalarCaptures.length ? 'const scalarValues = scalars.map(read => read());' : ''}
        ${declarations.length ? `let ${declarations.join(',')};` : ''}
        ${slots.size ? `let ${[...slots.values()].map(index => `reader${index}`).join(',')};` : ''}
        ${writtenSlots.size ? `let ${[...writtenSlots].map(name => `write${slots.get(name)}`).join(',')};` : ''}
        ${!scopedArrays && (proof.arrayWrites.size || proof.planBindings.size || proof.iterableBindings.size) ? 'args.forEach(noteArrayBinding);' : ''}
        ${scopedArrays ? `const bindings = arrayBindings(args); ${[...slots].filter(([name]) => statement.parameters.includes(name)).map(([, index]) => `bindings.bind(${index}, r${index});`).join('')}` : ''}
        let location = -1;
        try { ${lines.join('\n')} } catch (error) { throw locate(error, location); }
        ${scopedArrays ? 'finally { bindings.clear(); }' : ''}
    };`;
    const paramNames = statement.parameters.map((_, i) => `r${i}`);
    const localSlots = [...slots.values()].filter(i => i >= statement.parameters.length).map(i => `r${i}`);
    const directSource = `"use strict"; return function(locate, calls, userCalls, memberships, captures, scalars, planConsumed, rankedCalls, poll) {
        const checkpoint = poll ?? kernelCheckpoint;
        return function(${paramNames.join(',')}) {
            ${proof.planCalls.length ? 'const mappedCalls = [];' : ''}
            ${stableCaptures && scalarCaptures.length ? 'const scalarValues = scalars.map(read => read());' : ''}
            ${localSlots.length ? `let ${localSlots.join(',')};` : ''}
            ${slots.size ? `let ${[...slots.values()].map(index => `reader${index}`).join(',')};` : ''}
            ${writtenSlots.size ? `let ${[...writtenSlots].map(name => `write${slots.get(name)}`).join(',')};` : ''}
            ${!scopedArrays && (proof.arrayWrites.size || proof.planBindings.size || proof.iterableBindings.size) && paramNames.length ? `${paramNames.map(p => `noteArrayBinding(${p});`).join('')}` : ''}
            ${scopedArrays ? `const bindings = arrayBindings([${paramNames.join(',')}]); ${[...slots].filter(([name]) => statement.parameters.includes(name)).map(([, index]) => `bindings.bind(${index}, r${index});`).join('')}` : ''}
            let location = -1;
            try { ${lines.join('\n')} } catch (error) { throw locate(error, location); }
            ${scopedArrays ? 'finally { bindings.clear(); }' : ''}
        };
    };`;
    let kernel: Kernel | undefined;
    const prepareWriter = (value: RankValue) => prepareScalarArrayWriter(
        !calls.length && !userCalls.length && !proof.planCalls.length && privateLoopPolling() ? borrowArrayStorage(value) : value);
    const prepareReader = (value: RankValue, rank: number) => {
        const storage = !calls.length && !userCalls.length && !proof.planCalls.length && privateLoopPolling() ? borrowArrayStorage(value) : value;
        if (rank === 1) return prepareScalarArrayReader(storage, scalarSelection);
        // Multiaxis negative reads retain the ordinary selector's detailed error.
        if (rank === 2) {
            const read = prepareMatrixArrayReader(storage, scalarSelection);
            return (row: bigint, column: bigint) => row < 0n || column < 0n
                ? scalarSelection(value as RankArray, [row, column]) : read(row, column);
        }
        const read = prepareArrayReader(storage, scalarSelection);
        return (indices: readonly bigint[]) => indices.some(index => index < 0n)
            ? scalarSelection(value as RankArray, indices) : read(indices);
    };
    const writable = (array: RankArray) => {
        if (array.itemAt !== undefined && !hasDeferredSelectionCopy(array)) throw new RankError('cannot assign to a lazy array');
    };
    const loopValues = (value: RankArray | RankSequence) => isRankArray(value) ? arrayValues(value) : sequenceValues(value, 'for');
    // Explicit completion can copy proven scalar operands directly, without
    // building a persistent concat tree just to traverse it once.
    const concatCopy = (arrays: readonly RankArray[]) => {
        const items: RankValue[] = [];
        for (const array of arrays) for (const item of arrayValues(array)) items.push(item);
        return ownedArray(items, [items.length], true);
    };
    // Original arguments remain observable in error frames after a register
    // is rebound. Retain those values; ordinary locals can retire immediately.
    const arrayBindings = (inputs: readonly RankValue[]) => new ArrayBindingScope(value => {
        if (inputs.includes(value)) noteArrayBinding(value);
    });
    const arrayOperators = new Operators(() => {}, () => undefined);
    const arrayBinary = (name: string, left: RankValue, right: RankValue) => arrayOperators.evaluateBinary(name, left, right);
    const noteFold = () => { const diagnostics = currentDiagnostics(); if (diagnostics) diagnostics.compiledFunctionFolds++; };
    // Private numeric call views already represent completed, nonescaping
    // buffers. Preserve their zero-copy ABI across a linked helper graph.
    const completeArgument = (value: RankValue) => isBorrowedIntegerBuffer(value) ? value : materializeValue(value);
    const deferredArrayInputs = (inputs: RankArray[]) => inputs.some(value => denseScalarItems(value) === undefined);
    const returnedArrayPlan = (dependencies: ReadonlyMap<string, RankValue>, evaluate: () => RankValue): RankValue => ({
        kind: 'plan', dependencies, evaluate: () => completed(evaluate()),
    });
    const kernelArguments = [
        completeArgument, derivedArray, deferredArrayInputs, returnedArrayPlan, arrayBindings, loopValues, RankError, scalarSelection, noteArrayBinding, checkpoint, newStructure, addToCollection, expectAddCollection,
        indexGet, indexHas, indexRead, indexSet, checkValueMutable, indexKey, ownedArray, checkedArrayDimension,
        membershipLookup, scalarArrayWriteOffset, arrayForWrite, takeDropValue, copyArray, readArrayItem,
        prepareWriter, prepareReader, writable, materializeValue, argumentSelectionError, materializeCollection,
        textPoints, integerValue, formatValue, broadcastShape, FunctionPlanDemandError, setHas, textAt,
        sortValue, argsortValue, uniqueValue, applySelectors, compareCells, unpackApplicationItems, concatValues, concatCopy, materializeArray, reshapeWithDimensions, makeRange, arrayBinary, stackValues, tensorCells, noteFold,
    ];
    const kernelParameterNames = [
        'completeArgument', 'derivedArray', 'deferredArrayInputs', 'returnedArrayPlan', 'arrayBindings', 'loopValues', 'RankError', 'scalarSelection', 'noteArrayBinding', 'kernelCheckpoint', 'newStructure', 'addToCollection', 'expectAddCollection',
        'indexGet', 'indexHas', 'indexRead', 'indexSet', 'checkValueMutable', 'indexKey', 'ownedArray', 'checkedArrayDimension',
        'membershipLookup', 'scalarArrayWriteOffset', 'arrayForWrite', 'takeDropValue', 'copyArray', 'readArrayItem',
        'prepareWriter', 'prepareReader', 'writable', 'materializeValue', 'argumentSelectionError', 'materializeCollection',
        'textPoints', 'integerValue', 'formatValue', 'broadcastShape', 'FunctionPlanDemandError', 'setHas', 'textAt',
        'sortValue', 'argsortValue', 'uniqueValue', 'applySelectors', 'compareCells', 'unpackApplicationItems', 'concatValues', 'concatCopy', 'materializeArray', 'reshapeWithDimensions', 'makeRange', 'arrayBinary', 'stackValues', 'tensorCells', 'noteFold',
    ];
    try {
        const run = new Function(...kernelParameterNames, source)(...kernelArguments) as Kernel['run'];
        const direct = new Function(...kernelParameterNames, directSource)(...kernelArguments) as Kernel['direct'];
        // Default proofs already use integer parameter domains. Build the same
        // Number variant whichever caller first populates the proof-keyed cache.
        const numberDirect = compileScalarNumberKernel(statement, proof,
            parameterTypes ?? statement.parameters.map(() => 'integer' as const), locations, memberships, userCalls);
        kernel = {
            source,
            privateFolds: [...expressions.values()].some(expression => expression.kind === 'input' && expression.input.operation === 'fold'),
            plans: proof.planReturn || proof.planBindings.size > 0 || proof.iterableBindings.size > 0
                || [...expressions.values()].some(expression => expression.kind === 'input' && expression.input.operation === 'plan')
                || userCalls.some(call => !call.recursive && compileScalarFunction(call.statement, call.types, true, call.captures)?.plans),
            deques,
            setMembership,
            locations,
            calls,
            userCalls,
            rankedCalls: proof.planCalls,
            scalarCaptures,
            memberships,
            captures,
            guards: proof.nativeReads,
            modules: proof.modules,
            returnType: proof.type as CompiledCalleeType,
            run,
            direct,
            numberDirect,
            numberArrayArguments: (parameterTypes ?? []).flatMap((type,index) => typeof type !== 'string'
                && !isCompiledContainer(type) && type.rank === 1 && type.element === 'integer' ? [index] : []),
            numberStorage: proof.containers ? 'queues' : [...expressions.values()].some(expression =>
                expression.kind === 'input' && expression.input.operation === 'array')
                || parameterTypes?.some(type => typeof type !== 'string' && !isCompiledContainer(type)) ? 'arrays' : undefined,
        };
    }
    catch { /* CSP keeps the ordinary function implementation. */ }
    kernels.set(proof, kernel ?? null);
    return kernel ?? recordFallback('scalar-function:code-generation');
}
