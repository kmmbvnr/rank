import { checkValueMutable } from '../value-protection.js';
import { materializeValue } from '../materialize.js';
import { binaryOperatorSource, scalarExtremeSource, zeroTestSource } from './operator-codegen.js';
import { membershipLookup } from '../membership-lookup.js';
import { type CompiledCalleeType, isCompiledContainer } from './compiled-callee-type.js';
import { newStructure, addToCollection, expectAddCollection, setHas } from '../collections.js';
import { indexGet, indexHas, indexRead, indexSet, indexKey } from '../index-storage.js';
import {
    findCompiledOperator, applicationForm, findOperation, rangeSliceOperands,
    isReturnStatement, isExpressionStatement, isAssignmentStatement, isIfStatement, isForStatement, isBinaryExpression, isParenthesizedExpression, forIteration, isPushStatement, isNameExpression, isArrayAssignmentStatement, isBreakStatement, isContinueStatement, isUnpackStatement,
    type CompiledExpression, type CompiledOperator, type CompiledScalarType, type Operation, type Expression, type FunctionStatement, type Statement,
} from '@arrrank/language';
import { sequenceValues } from '../sequence.js';
import { checkpoint, privateLoopPolling } from '../interrupt.js';
import { argumentSelectionError, RankError } from '../errors.js';
import { recordFallback } from '../diagnostics.js';
import { isRankArray, type RankArray, type RankSequence, type RankValue } from '../value.js';
import type { LoopCallable } from './integer-loop-plan.js';
import { scalarArrayWriteOffset } from '../selectors.js';
import { checkedArrayDimension } from '../tensor-index.js';
import { arrayValues, arrayForWrite, ownedArray, noteArrayBinding, readArrayItem, borrowArrayStorage, prepareScalarArrayWriter, prepareArrayReader, prepareScalarArrayReader, prepareMatrixArrayReader } from '../array-storage.js';
import { scalarSelection } from './scalar-selection.js';
import { takeDropValue } from '../sequence.js';
import { copyArray, materializeCollection } from '../modules/sequences.js';
import { hasDeferredSelectionCopy } from '../integer-view.js';
import { scalarFunctionResult, type ScalarFunctionProof, type ScalarFunctionInput, type ScalarCaptureTypes, type ScalarLoopIterable } from './scalar-function-proof.js';
import { emitFunctionPlan, functionPlanArrays, functionPlanCallbacks, FunctionPlanDemandError } from '../function-plan.js';
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
    readonly dequeIteration: boolean;
    readonly setMembership: boolean;
    readonly userCalls: readonly { name: string; statement: FunctionStatement; types: readonly CompiledCalleeType[]; locals: readonly string[]; tail: boolean; recursive?: boolean; captures?: ScalarCaptureTypes }[];
    readonly rankedCalls: ScalarFunctionProof['planCalls'];
    readonly scalarCaptures: readonly { name: string; type: CompiledScalarType }[];
    readonly memberships: readonly string[];
    readonly captures: readonly { name: string; rank: number }[];
    readonly calls: readonly { operation: Operation; inputs: readonly string[]; iterator?: boolean }[];
    readonly guards: readonly string[];
    readonly modules: readonly string[];
    readonly locations: readonly (Statement | Expression)[];
    run(arguments_: RankValue[], locate: (error: unknown, index: number) => unknown, calls?: readonly LoopCallable[],
        userCalls?: readonly LoopCallable[],
        memberships?: readonly ((value: bigint) => boolean)[],
        captures?: readonly ((indices: bigint[]) => bigint)[], scalars?: readonly (() => RankValue)[], planConsumed?: () => void, rankedCalls?: readonly (() => (arguments_: RankValue[]) => RankValue)[]): RankValue;
    readonly direct?: (locate: (error: unknown, index: number) => unknown,
        calls?: readonly LoopCallable[],
        userCalls?: readonly LoopCallable[],
        memberships?: readonly ((value: bigint) => boolean)[],
        captures?: readonly ((indices: bigint[]) => bigint)[],
        scalars?: readonly (() => RankValue)[],
        planConsumed?: () => void,
        rankedCalls?: readonly (() => (arguments_: RankValue[]) => RankValue)[]) => LoopCallable;
    readonly numberDirect?: (locate: (error: unknown, index: number) => unknown,
        safe: (val: number) => number,
        zero: () => Error,
        overflow: unknown,
        checkpoint: () => void,
        badStep?: () => Error,
        powerZero?: () => Error,
        powerDomain?: () => Error) => LoopCallable;
}
const kernels = new WeakMap<ScalarFunctionProof, Kernel | null>();

function compileScalarNumberKernel(
    statement: FunctionStatement,
    proof: ScalarFunctionProof,
    parameterTypes: readonly CompiledCalleeType[],
    locations: readonly (Statement | Expression)[],
): Kernel['numberDirect'] | undefined {
    if (proof.containers || proof.arrayWrites.size || proof.planCalls.length
        || proof.planBindings.size || proof.planReturn || proof.nativeReads.length
        || proof.dependencies.length || proof.callCount > 0) return undefined;
    const isNumType = (t: CompiledCalleeType) => t === 'integer' || t === 'real' || t === 'boolean';
    if (!isNumType(proof.type) || !parameterTypes.every(isNumType)) return undefined;

    const slots = new Map<string, number>();
    const slot = (name: string): string => {
        if (!slots.has(name)) slots.set(name, slots.size);
        return `r${slots.get(name)}`;
    };
    statement.parameters.forEach(slot);
    let serial = 0;

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
            if (compiled.input.operation) return undefined;
            return slot(compiled.input.name);
        }
        if (compiled.kind === 'unary') {
            const val = lowerNum(compiled.operand, lines);
            if (!val) return undefined;
            const res = `v${serial++}`;
            if (compiled.operation.name === '-') {
                lines.push(`const ${res} = safe(-(${val}));`);
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
        if (compiled.kind === 'call') return undefined;
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
        const left = lowerNum(compiled.left, lines), right = lowerNum(compiled.right, lines);
        if (!left || !right) return undefined;
        const res = `v${serial++}`;
        if (op === '+' || op === '-' || op === '*') {
            const isInteger = compiled.signature.result === 'integer';
            const calc = `(${left}) ${compiled.operation.binary} (${right})`;
            lines.push(`const ${res} = ${isInteger ? `safe(${calc})` : calc};`);
        } else if (op === '/' || op === '//' || op === 'mod' || op === '**') {
            if (op === '/') {
                lines.push(`if (${right} === 0) throw zero();`);
                lines.push(`const ${res} = (${left}) / (${right});`);
            } else if (op === '//' || op === 'mod') {
                lines.push(`if (${right} === 0) throw zero();`);
                const remainder = `v${serial++}`;
                lines.push(`const ${remainder} = (${left}) % (${right});`);
                lines.push(`const ${res} = ${binaryOperatorSource(compiled.operation, left, right, { number: true, remainder, safe: s => `safe(${s})` })};`);
            } else if (op === '**') {
                lines.push(`if (${zeroTestSource(left, 'numeric')} && (${right}) < 0) throw powerZero();`);
                const isInteger = compiled.signature.result === 'integer';
                lines.push(`const ${res} = ${isInteger ? `safe((${left}) ** (${right}))` : `(${left}) ** (${right})`};`);
                if (!isInteger) lines.push(`if (Number.isNaN(${res})) throw powerDomain();`);
            }
        } else if (['<', '<=', '>', '>=', '==', '!=', 'equal', 'notequal'].includes(op) || compiled.operation.binary) {
            lines.push(`const ${res} = (${left}) ${compiled.operation.binary} (${right});`);
        } else return undefined;
        return res;
    }

    function lowerCommands(statements: readonly Statement[], lines: string[]): boolean {
        for (const cmd of statements) {
            const loc = locations.indexOf(cmd);
            lines.push(`location = ${loc};`);
            if (isReturnStatement(cmd)) {
                if (!cmd.value) { lines.push('return undefined;'); continue; }
                const val = emitNum(cmd.value, lines);
                if (!val) return false;
                lines.push(`return ${proof.type === 'integer' ? `safe(${val})` : val};`);
            } else if (isExpressionStatement(cmd)) {
                if (!emitNum(cmd.value, lines)) return false;
            } else if (isAssignmentStatement(cmd)) {
                let val = emitNum(cmd.value, lines);
                if (!val) return false;
                if (cmd.operator !== '=') {
                    const op = findCompiledOperator(cmd.operator.slice(0, -1));
                    if (!op) return false;
                    const prev = slot(cmd.name);
                    const calc = `(${prev}) ${op.binary} (${val})`;
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
                if (binding && binding.iterable && binding.names.length === 1 && !binding.names[0].includes('.')) {
                    let rangeExpr = binding.iterable;
                    while (isParenthesizedExpression(rangeExpr)) rangeExpr = rangeExpr.value;
                    const range = rangeSliceOperands(rangeExpr);
                    if (range) {
                        const start = emitNum(range.start, lines);
                        const end = emitNum(range.end, lines);
                        if (!start || !end) return false;
                        const induction = slot(binding.names[0]);
                        const endVar = `end${serial++}`;
                        const cmp = range.inclusive ? '<=' : '<';
                        lines.push(`const ${endVar} = ${end};`);
                        lines.push(`for (let ${induction} = ${start}; ${induction} ${cmp} ${endVar}; ${induction} = safe(${induction} + 1)) { checkpoint();`);
                        if (!lowerCommands(cmd.statements, lines)) return false;
                        lines.push('}');
                        continue;
                    }
                    if (isBinaryExpression(rangeExpr) && (rangeExpr.operator === 'to' || rangeExpr.operator === 'till')) {
                        const start = emitNum(rangeExpr.left, lines);
                        const end = emitNum(rangeExpr.right, lines);
                        const step = rangeExpr.step ? emitNum(rangeExpr.step, lines) : '1';
                        if (!start || !end || !step) return false;
                        const induction = slot(binding.names[0]);
                        const endVar = `end${serial++}`, stepVar = `step${serial++}`;
                        const cmp = rangeExpr.operator === 'to' ? '<=' : '<';
                        lines.push(`const ${endVar} = ${end}, ${stepVar} = ${step};`);
                        lines.push(`if (${stepVar} === 0) throw badStep();`);
                        lines.push(`for (let ${induction} = ${start}; ${stepVar} > 0 ? ${induction} ${cmp} ${endVar} : ${induction} >= ${endVar}; ${induction} = safe(${induction} + ${stepVar})) { checkpoint();`);
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
    const source = `"use strict"; return function(locate, safe, zero, overflow, checkpoint, badStep, powerZero, powerDomain) {
        return function(${paramNames.join(',')}) {
            ${localSlots.length ? `let ${localSlots.join(',')};` : ''}
            let location = -1;
            try { ${lines.join('\n')} } catch (error) { throw locate(error, location); }
        };
    };`;
    try {
        return new Function(source)() as Kernel['numberDirect'];
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
    // Guarded captures cannot change when assignments are local, polling is
    // private, and the invocation makes no native or nested user calls.
    const stableCaptures = !proof.callCount && ![...expressions.values()].some(expression => expression.kind === 'call');
    const slots = new Map<string, number>();
    const slot = (name: string): string => {
        if (!slots.has(name)) slots.set(name, slots.size);
        return `r${slots.get(name)}`;
    };
    statement.parameters.forEach(slot);
    const locations: (Statement | Expression)[] = [];
    const calls: { operation: Operation; inputs: readonly string[]; iterator?: boolean }[] = [];
    const userCalls: { name: string; statement: FunctionStatement; types: readonly CompiledCalleeType[]; locals: readonly string[]; tail: boolean; recursive?: boolean; captures?: ScalarCaptureTypes }[] = [];
    const scalarCaptures: { name: string; type: CompiledScalarType }[] = [];
    const memberships: string[] = [];
    const captures: { name: string; rank: number }[] = [];
    const writtenSlots = new Set([...proof.arrayWrites].filter(isArrayAssignmentStatement).map(command => command.name));
    let serial = 0, dequeIteration = false, setMembership = false;
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
    function iterable(source: ScalarLoopIterable, lines: string[]): string {
        if (source.kind === 'literal') return emit(source.expression, lines);
        const argument = 'kind' in source.source ? iterable(source.source, lines) : emit(source.source, lines);
        const index = calls.push({ operation: source.operation, inputs: [], iterator: true }) - 1;
        const result = `v${serial++}`;
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
            if (operation === 'plan') return emitFunctionPlan(expression.input.plan!, lines, {
                variable: () => `v${serial++}`, slot, binary,
                locate: (source, body, demandLocation) => {
                    let owner = source.$container;
                    while (owner && !isAssignmentStatement(owner)) owner = owner.$container;
                    body.push(`location = ${owner && isAssignmentStatement(owner) && owner.deferred ? locations.push(source) - 1 : demandLocation};`);
                },
                capture: (key, body) => body.push(`mappedCalls[${key}] = rankedCalls[${key}]();`),
                callback: (key, value, body) => {
                    const result = `v${serial++}`;
                    body.push(`const ${result} = mappedCalls[${key}]([${value}]);`);
                    return result;
                },
            });
            if (operation === 'materialize-deque') {
                const value = lower(expression.input.indices![0], lines), result = `v${serial++}`;
                lines.push(`const ${result} = materializeCollection(${value});`);
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
                const arguments_ = expression.input.indices!.map(argument => lower(argument, lines));
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
                const body = proof!.planReturns.has(command) ? [] : lines;
                const value = emit(command.value, body, true);
                if (typeof expressions.get(command.value)!.type !== 'string') body.push(`noteArrayBinding(${value});`);
                body.push(`return ${value};`);
                if (body !== lines) {
                    const origin = locations.push(command.value) - 1;
                    lines.push(`try { ${body.join('\n')} } catch (error) { throw new FunctionPlanDemandError(locate(error, ${origin})); }`);
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
                if (proof!.arrayWrites.size && typeof expressions.get(command.value)!.type !== 'string') lines.push(`noteArrayBinding(${slot(command.name)});`);
            } else if (isUnpackStatement(command)) {
                const value = emit(command.value, lines), unpacked = `v${serial++}`;
                lines.push(`const ${unpacked} = unpackApplicationItems(${value});`);
                lines.push(`if (${unpacked}.length !== ${command.names.length}) throw new RankError('unpack expects ${command.names.length} values, got ' + ${unpacked}.length);`);
                command.names.forEach((name, index) => {
                    if (name !== '#') lines.push(`${slot(name)} = ${unpacked}[${index}]; reader${slots.get(name)} = undefined;`);
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
                        if (${copy}) { ${receiver} = ${copy}; noteArrayBinding(${receiver}); ${writer} = undefined; reader${slots.get(command.name)} = undefined; }
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
                        lines.push(`noteArrayBinding(${source});`);
                        if (indexed) lines.push(`let ordinal${id} = 0n;`);
                        lines.push(`for (const point${id} of loopValues(${source})) { location = ${location}; checkpoint();`);
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
                        dequeIteration ||= !!deque;
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
    const source = `"use strict"; return function(args, locate, calls, userCalls, memberships, captures, scalars, planConsumed, rankedCalls) {
        ${proof.planCalls.length ? 'const mappedCalls = [];' : ''}
        ${stableCaptures && scalarCaptures.length ? 'const scalarValues = scalars.map(read => read());' : ''}
        ${declarations.length ? `let ${declarations.join(',')};` : ''}
        ${slots.size ? `let ${[...slots.values()].map(index => `reader${index}`).join(',')};` : ''}
        ${writtenSlots.size ? `let ${[...writtenSlots].map(name => `write${slots.get(name)}`).join(',')};` : ''}
        ${proof.arrayWrites.size || proof.planBindings.size ? 'args.forEach(noteArrayBinding);' : ''}
        let location = -1;
        try { ${lines.join('\n')} } catch (error) { throw locate(error, location); }
    };`;
    const paramNames = statement.parameters.map((_, i) => `r${i}`);
    const localSlots = [...slots.values()].filter(i => i >= statement.parameters.length).map(i => `r${i}`);
    const directSource = `"use strict"; return function(locate, calls, userCalls, memberships, captures, scalars, planConsumed, rankedCalls) {
        return function(${paramNames.join(',')}) {
            ${proof.planCalls.length ? 'const mappedCalls = [];' : ''}
            ${stableCaptures && scalarCaptures.length ? 'const scalarValues = scalars.map(read => read());' : ''}
            ${localSlots.length ? `let ${localSlots.join(',')};` : ''}
            ${slots.size ? `let ${[...slots.values()].map(index => `reader${index}`).join(',')};` : ''}
            ${writtenSlots.size ? `let ${[...writtenSlots].map(name => `write${slots.get(name)}`).join(',')};` : ''}
            ${(proof.arrayWrites.size || proof.planBindings.size) && paramNames.length ? `${paramNames.map(p => `noteArrayBinding(${p});`).join('')}` : ''}
            let location = -1;
            try { ${lines.join('\n')} } catch (error) { throw locate(error, location); }
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
    const kernelArguments = [
        loopValues, RankError, scalarSelection, noteArrayBinding, checkpoint, newStructure, addToCollection, expectAddCollection,
        indexGet, indexHas, indexRead, indexSet, checkValueMutable, indexKey, ownedArray, checkedArrayDimension,
        membershipLookup, scalarArrayWriteOffset, arrayForWrite, takeDropValue, copyArray, readArrayItem,
        prepareWriter, prepareReader, writable, materializeValue, argumentSelectionError, materializeCollection,
        textPoints, integerValue, formatValue, broadcastShape, FunctionPlanDemandError, setHas, textAt,
        sortValue, argsortValue, uniqueValue, applySelectors, compareCells, unpackApplicationItems,
    ];
    const kernelParameterNames = [
        'loopValues', 'RankError', 'scalarSelection', 'noteArrayBinding', 'checkpoint', 'newStructure', 'addToCollection', 'expectAddCollection',
        'indexGet', 'indexHas', 'indexRead', 'indexSet', 'checkValueMutable', 'indexKey', 'ownedArray', 'checkedArrayDimension',
        'membershipLookup', 'scalarArrayWriteOffset', 'arrayForWrite', 'takeDropValue', 'copyArray', 'readArrayItem',
        'prepareWriter', 'prepareReader', 'writable', 'materializeValue', 'argumentSelectionError', 'materializeCollection',
        'textPoints', 'integerValue', 'formatValue', 'broadcastShape', 'FunctionPlanDemandError', 'setHas', 'textAt',
        'sortValue', 'argsortValue', 'uniqueValue', 'applySelectors', 'compareCells', 'unpackApplicationItems',
    ];
    try {
        const run = new Function(...kernelParameterNames, source)(...kernelArguments) as Kernel['run'];
        const direct = new Function(...kernelParameterNames, directSource)(...kernelArguments) as Kernel['direct'];
        const numberDirect = parameterTypes ? compileScalarNumberKernel(statement, proof, parameterTypes, locations) : undefined;
        kernel = {
            source,
            plans: proof.planBindings.size > 0 || [...expressions.values()].some(expression => expression.kind === 'input' && expression.input.operation === 'plan'),
            dequeIteration,
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
        };
    }
    catch { /* CSP keeps the ordinary function implementation. */ }
    kernels.set(proof, kernel ?? null);
    return kernel ?? recordFallback('scalar-function:code-generation');
}
