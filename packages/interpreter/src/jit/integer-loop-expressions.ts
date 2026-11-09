import { primeLoopBounds } from '../loop-traversal.js';
import { fitsIntegerRepresentation } from './integer-representation.js';
import { integerRange, safeIntegerRange, type IntegerRange } from './integer-range-facts.js';
import { positionalDeclaredCall } from './declared-scalar-call.js';
import { binaryOperatorSource, scalarExtremeSource, zeroTestSource, numberBitwiseSource } from './operator-codegen.js';
import { numericBoundSource } from './numeric-bound-codegen.js';
import { AstUtils } from 'langium';
import { loopValueType, type LoopHost, type LoopTerm } from './integer-loop-plan.js';
import { compiledIntegerMembership } from '../integer-membership.js';
import { compiledNumberSequenceMembership } from '../sequence-membership.js';
import { type CompiledCalleeType } from './compiled-callee-type.js';
import { ResourceMap } from '../resource-summary.js';
import { IntegerEntries } from '../integer-entries.js';
import { IndexEntries } from '../index-storage.js';
import { hasNativeFenwick } from '../fenwick.js';
import { hasNativeIntegerGroups } from '../runtime/integer-groups.js';
import { compiledArgumentType, compiledStoredArgumentType, hasNativeDeque } from './compiled-argument-type.js';
import {
    symbolicApplicationForm, groupedUnaryDyadicChain, compiledCallSignatures, matchCompiledCallSignature, scalarChooseOperands, applicationExpression, rangeSliceOperands, flattenApplication, unaryApplicationHead, expressionFacts, findOperation, findCompiledOperator, inferCompiledExpression,
    loopOperatorSignature, isApplicationExpression, isDeclaredCallExpression, isBinaryExpression, isUnaryExpression, isStringLiteral,
    isAssignmentStatement, isArrayAssignmentStatement, isFirstIndexWhereExpression, isCountClauseExpression, isSubjectComparisonExpression, isMaterializeExpression, isTableFilterExpression, isParenthesizedExpression, isBooleanLiteral, isNumberLiteral, isNameExpression, isArrayExpression, isAllAxisExpression, applicationForm, type Expression, type CompiledLoopType,
    type CompiledExpression, type Operation, type CompiledArrayType, type CompiledCallSignature,
} from '@arrrank/language';
import { isRankArray, isRankIndex, isRankSet } from '../value.js';
import { integerLiteral } from '../eval/application.js';
import { resolveAxis, resolveAxes, safeDimension } from '../tensor-index.js';
import { RankDeque } from '../containers.js';
import { denseScalarItems, materializedArrayItems, arrayRevision, storedScalarKinds } from '../array-storage.js';

import { describeCompilerRejection, recordCompilerRejection } from './compiler-rejection.js';
import type { LoopCompilationState } from './integer-loop-state.js';

/** Pure builtins inlined as `Value name`; runtime entry rechecks their bindings. */
interface InlineBuiltin {
    readonly module: string;
    readonly types: Partial<Record<LoopTerm['type'], LoopTerm['type']>>;
    readonly enabled?: (host: LoopHost) => boolean;
    /** The interpreter's DomainError for operands outside the domain. */
    readonly domain?: { test(value: string, type: LoopTerm['type']): string | undefined; message: string };
    readonly exactCode?: (value: string) => string;
    code(value: string, type: LoopTerm['type'], numberMode: boolean): string;
}
const parity = (even: boolean): InlineBuiltin => ({ module: 'numbers', types: { integer: 'boolean' },
    code: (value, _, numberMode) => numberMode ? `((${value}) % 2 ${even ? '===' : '!=='} 0)`
        : `(BigInt.asUintN(1, ${value}) ${even ? '===' : '!=='} 0n)` });
const bound = (name: 'floor' | 'ceil'): InlineBuiltin => ({ module: 'numbers', types: { integer: 'integer', real: 'integer' },
    enabled: host => host.reals,
    domain: { test: (value, type) => type === 'real' ? `!Number.isFinite(${value})` : undefined, message: `${name} expects a finite number` },
    code: (value, type, numberMode) => numericBoundSource(name, value, type === 'real' ? 'real' : 'integer', numberMode) });
const inlineBuiltins = new Map<string, InlineBuiltin>([
    ['abs', { module: 'numbers', types: { integer: 'integer', real: 'real' }, enabled: host => host.absolute,
        code: (value, type, numberMode) => type === 'real' ? `Math.abs(${value})`
            : `(${value}) < ${numberMode ? '0' : '0n'} ? -(${value}) : (${value})` }],
    ['even', parity(true)],
    ['odd', parity(false)],
    ['sqrt', { module: 'numbers', types: { integer: 'real', real: 'real' }, enabled: host => host.reals,
        domain: { test: value => `(${value}) < 0`, message: 'sqrt expects a nonnegative value' },
        code: (value, type) => `Math.sqrt(${type === 'integer' ? `Number(${value})` : value})` }],
    ['isqrt', { module: 'numbers', types: { integer: 'integer' },
        domain: { test: value => `(${value}) < 0`, message: 'isqrt expects a nonnegative integer' },
        exactCode: value => `wideIsqrt(${value})`,
        code: value => `isqrt(${value})` }],
    ['acos', { module: 'numbers', types: { integer: 'real', real: 'real' }, enabled: host => host.reals,
        domain: { test: value => `!((${value}) >= -1 && (${value}) <= 1)`, message: 'acos input is outside its domain' },
        code: value => `Math.acos(Number(${value}))` }],
    ['log', { module: 'numbers', types: { integer: 'real', real: 'real' }, enabled: host => host.reals,
        domain: { test: value => `!Number.isFinite(Number(${value})) || !(${value} > 0)`, message: 'log input is outside its domain' },
        code: value => `Math.log(Number(${value}))` }],
    ['expm1', { module: 'numbers', types: { integer: 'real', real: 'real' }, enabled: host => host.reals,
        code: value => `Math.expm1(Number(${value}))` }],
    ['floor', bound('floor')],
    ['ceil', bound('ceil')],
]);

// Code-size budget, not a numeric precision or array-size limit. Number array
// accesses spend IDs on coordinate/bounds checks too; bounded-Y Euler 212
// exhausted the old 256-ID budget. Fresh-process probes (see
// benchmarks/euler212-compiler-budget-results.md) found that 1024 admits useful
// medium regions while retaining fallback for a ~559 KB exact+Number expansion
// whose preparation and short-run cost increased without a cap. This is a
// conservative heuristic, not a universal optimum; the separate 128-statement
// and per-expression inference budgets still apply.
const MAX_LOOP_TEMPORARIES = 1024;

// Largest modulus whose nonnegative residue products all fit safe Number
// integers. Above it, direct imul reduction avoids repeated product dispatch.
// Euler 374: 1.028 -> 0.653 s on Mac, 1.457 -> 1.368 s on Intel; applying
// that policy to small moduli slowed Euler 365. See euler374-investigation.md.
const MAX_SAFE_RESIDUE_MODULUS = Math.floor(Math.sqrt(Number.MAX_SAFE_INTEGER)) + 1;

interface NumberVector {
    readonly size: string;
    readonly shape: string;
    readonly rank: number;
    readonly type: 'integer' | 'boolean' | 'real';
    readonly sources: readonly string[];
    readonly compactGuards: readonly string[];
    cell(index: string, lines: string[], frame?: NumberVectorFrame): LoopTerm | undefined;
}
interface NumberVectorFrame {
    readonly shape: string;
    readonly rank: number;
    readonly compact?: boolean;
    readonly offsets: Map<string, string>;
    readonly values: Map<string, LoopTerm>;
}
/** Expression lowering records its required bindings on the current plan. */
export function createLoopExpressions(state: LoopCompilationState, wide = false) {
    const {
        host, textSources, localTypes, names, required, assigned, containers, builtins,
        calls, arrays, calleeArrays, arrayInputs, destinations, reject,
    } = state;
    const numberMode = state.numberMode && !wide;
    const safe = wide ? (code: string) => code : state.safe;

    const scalarInputs = new Map<Expression, LoopTerm>();
    let vectorCellDepth = 0;

    function temporaryBudget(source: Expression): boolean {
        if (state.serial <= MAX_LOOP_TEMPORARIES) return true;
        recordCompilerRejection(describeCompilerRejection(state.numberMode ? 'number-loop' : 'loop', source, 'temporary-budget'));
        return false;
    }
    function container(name: string, kind: 'index' | 'deque' | 'set' | 'fenwick' | 'groups', integers = false): string | undefined {
        if (name.includes('.')) return undefined;
        const old = containers.get(name);
        if (old && (old.kind !== kind || integers && old.array)) return undefined;
        const info = old ?? { slot: slot(name), kind, integers };
        info.integers ||= integers;
        containers.set(name, info);
        return `r${info.slot}`;
    }
    function slot(name: string): number {
        let index = names.indexOf(name);
        if (index < 0) { index = names.length; names.push(name); }
        return index;
    }
    /** Scalar coordinates share axis checks and row-major addressing for reads and writes. */
    function numberOffset(info: { slot: number; rank: number }, indices: readonly string[], lines: string[], write = false): string {
        const scope = state.numberMode ? state.currentScope() : undefined;
        if (!scope || !scope.range) {
            let offset = '0';
            indices.forEach((index, axis) => {
                const coordinate = `index${state.serial++}`;
                const size = info.rank === 1 ? `cells${info.slot}.length` : `size${info.slot}_${axis}`;
                lines.push(`const ${coordinate} = ${index};
                    if (${coordinate} < 0 || ${coordinate} >= ${size}) throw ${write ? 'badWriteIndex' : 'badIndex'}(${coordinate}, ${axis});`);
                const value = wide ? `Number(${coordinate})` : coordinate;
                offset = axis === 0 ? value : `(${offset} * ${size} + ${value})`;
            });
            const key = `key${state.serial++}`;
            lines.push(`const ${key} = ${offset};`);
            return key;
        }

        // 1D Array Access: BCE via entry range guard if index is the unit-stride induction variable
        if (info.rank === 1) {
            const index = indices[0];
            const size = `cells${info.slot}.length`;
            const coordinate = `index${state.serial++}`;
            const isLocalDef = state.reboundNames.has(names[info.slot]);
            const isInduction = !isLocalDef && scope.range.unitStride && scope.inductionSlot !== undefined
                && (index === `r${scope.inductionSlot}` || index === 'cursor');

            if (isInduction) {
                const guardKey = `${info.slot}_0`;
                let guardVar = scope.bceGuards.get(guardKey);
                if (!guardVar) {
                    guardVar = `bce_${info.slot}_0_${state.serial++}`;
                    scope.bceGuards.set(guardKey, guardVar);
                    const cmp = scope.range.operator === 'to' ? '<' : '<=';
                    scope.setupLines.push(`const ${guardVar} = (${scope.range.strideCode} === 1 && ${scope.range.startCode} >= 0 && ${scope.range.endCode} ${cmp} ${size});`);
                }
                lines.push(`const ${coordinate} = ${index};
                    if (!${guardVar}) {
                        if (${coordinate} < 0 || ${coordinate} >= ${size}) throw ${write ? 'badWriteIndex' : 'badIndex'}(${coordinate}, 0);
                    }`);
            } else {
                lines.push(`const ${coordinate} = ${index};
                    if (${coordinate} < 0 || ${coordinate} >= ${size}) throw ${write ? 'badWriteIndex' : 'badIndex'}(${coordinate}, 0);`);
            }
            const key = `key${state.serial++}`;
            lines.push(`const ${key} = ${coordinate};`);
            return key;
        }

        // Multi-dimensional Array Access (rank >= 2)
        const lastAxis = info.rank - 1;
        const leadingIndices = indices.slice(0, lastAxis);
        const isLocalDef = state.reboundNames.has(names[info.slot]);
        const leadingInvariant = !isLocalDef && scope.depth >= 1 && leadingIndices.every(coord => {
            if (coord === `r${scope.inductionSlot}` || coord === 'cursor') return false;
            const match = /^r(\d+)$/.exec(coord);
            if (match) {
                const s = Number(match[1]);
                const varName = names[s];
                if (varName && scope.assigned.has(varName)) return false;
                return true;
            }
            // Expression temporaries are declared at the read site. They are
            // neither in scope nor proven invariant in the loop preheader.
            return /^-?\d+$/.test(coord);
        });

        if (leadingInvariant) {
            // Hoist outer row base calculation out of the inner loop into scope.setupLines
            const offsetKey = `${info.slot}_${leadingIndices.join('_')}`;
            let rowBaseVar = scope.hoistedOffsets.get(offsetKey);
            if (!rowBaseVar) {
                rowBaseVar = `rowBase_${info.slot}_${state.serial++}`;
                scope.hoistedOffsets.set(offsetKey, rowBaseVar);

                let baseExpr = leadingIndices[0];
                for (let a = 1; a < leadingIndices.length; a++) {
                    baseExpr = `(${baseExpr} * size${info.slot}_${a} + ${leadingIndices[a]})`;
                }
                baseExpr = `(${baseExpr} * size${info.slot}_${lastAxis})`;
                scope.setupLines.push(`const ${rowBaseVar} = ${baseExpr};`);
            }

            // Checks for leading axes: if outer BCE guard exists, skip when guard holds
            leadingIndices.forEach((coord, axis) => {
                const size = `size${info.slot}_${axis}`;
                let outerGuard: string | undefined;
                for (const s of state.loopScopes) {
                    if (s !== scope && s.inductionSlot !== undefined && coord === `r${s.inductionSlot}`) {
                        outerGuard = s.bceGuards.get(`${info.slot}_${axis}`);
                        break;
                    }
                }
                if (outerGuard) {
                    lines.push(`if (!${outerGuard}) {
                        if (${coord} < 0 || ${coord} >= ${size}) throw ${write ? 'badWriteIndex' : 'badIndex'}(${coord}, ${axis});
                    }`);
                } else {
                    lines.push(`if (${coord} < 0 || ${coord} >= ${size}) throw ${write ? 'badWriteIndex' : 'badIndex'}(${coord}, ${axis});`);
                }
            });

            const lastCoord = indices[lastAxis];
            const lastSize = `size${info.slot}_${lastAxis}`;
            const coordinate = `index${state.serial++}`;
            const isTrailingInduction = scope.range.unitStride && scope.inductionSlot !== undefined
                && (lastCoord === `r${scope.inductionSlot}` || lastCoord === 'cursor');

            if (isTrailingInduction) {
                const guardKey = `${info.slot}_${lastAxis}`;
                let guardVar = scope.bceGuards.get(guardKey);
                if (!guardVar) {
                    guardVar = `bce_${info.slot}_${lastAxis}_${state.serial++}`;
                    scope.bceGuards.set(guardKey, guardVar);
                    const cmp = scope.range.operator === 'to' ? '<' : '<=';
                    scope.setupLines.push(`const ${guardVar} = (${scope.range.strideCode} === 1 && ${scope.range.startCode} >= 0 && ${scope.range.endCode} ${cmp} ${lastSize});`);
                }
                lines.push(`const ${coordinate} = ${lastCoord};
                    if (!${guardVar}) {
                        if (${coordinate} < 0 || ${coordinate} >= ${lastSize}) throw ${write ? 'badWriteIndex' : 'badIndex'}(${coordinate}, ${lastAxis});
                    }`);
            } else {
                lines.push(`const ${coordinate} = ${lastCoord};
                    if (${coordinate} < 0 || ${coordinate} >= ${lastSize}) throw ${write ? 'badWriteIndex' : 'badIndex'}(${coordinate}, ${lastAxis});`);
            }

            const key = `key${state.serial++}`;
            lines.push(`const ${key} = ${rowBaseVar} + ${coordinate};`);
            return key;
        }

        // Multi-dimensional without hoisting (e.g. at root level)
        let offset = '0';
        indices.forEach((index, axis) => {
            const coordinate = `index${state.serial++}`;
            const size = `size${info.slot}_${axis}`;
            const isInduction = !isLocalDef && scope.range!.unitStride && scope.inductionSlot !== undefined
                && (index === `r${scope.inductionSlot}` || index === 'cursor');

            if (isInduction) {
                const guardKey = `${info.slot}_${axis}`;
                let guardVar = scope.bceGuards.get(guardKey);
                if (!guardVar) {
                    guardVar = `bce_${info.slot}_${axis}_${state.serial++}`;
                    scope.bceGuards.set(guardKey, guardVar);
                    const cmp = scope.range!.operator === 'to' ? '<' : '<=';
                    scope.setupLines.push(`const ${guardVar} = (${scope.range!.strideCode} === 1 && ${scope.range!.startCode} >= 0 && ${scope.range!.endCode} ${cmp} ${size});`);
                }
                lines.push(`const ${coordinate} = ${index};
                    if (!${guardVar}) {
                        if (${coordinate} < 0 || ${coordinate} >= ${size}) throw ${write ? 'badWriteIndex' : 'badIndex'}(${coordinate}, ${axis});
                    }`);
            } else {
                lines.push(`const ${coordinate} = ${index};
                    if (${coordinate} < 0 || ${coordinate} >= ${size}) throw ${write ? 'badWriteIndex' : 'badIndex'}(${coordinate}, ${axis});`);
            }
            const value = wide ? `Number(${coordinate})` : coordinate;
            offset = axis === 0 ? value : `(${offset} * ${size} + ${value})`;
        });
        const key = `key${state.serial++}`;
        lines.push(`const ${key} = ${offset};`);
        return key;
    }
    function knownType(expression: Expression): LoopTerm['type'] | undefined {
        while (isParenthesizedExpression(expression)) expression = expression.value;
        const input = scalarInputs.get(expression);
        if (input) return input.type;
        const fact = expressionFacts(expression, name => {
            const local = localTypes.get(name);
            if (local) return { types: [local] };
            // This only selects a specialization; required inputs are guarded
            // again on every entry. Never retain a value or invocation frame.
            const type = loopValueType(host.read(name));
            return type && { types: [type] };
        });
        const type = fact.types.length === 1 ? fact.types[0] : undefined;
        return type === 'integer' || type === 'boolean' || type === 'text' || type === 'bytes'
            || type === 'real' && host.reals ? type : undefined;
    }
    /** Real bindings and arrays of reals select real registers. This only
     * chooses a specialization; entry guards check every input and cell. */
    function realInput(name: string): 'real' | undefined {
        if (!host.reals) return undefined;
        const value = host.read(name);
        const first = value && isRankArray(value)
            ? arrayRevision(value) === undefined ? undefined
                : (denseScalarItems(value) ?? materializedArrayItems(value))?.[0] : value;
        return typeof first === 'number' ? 'real' : undefined;
    }
    type LoopValue = LoopTerm | { readonly code: string; readonly type: CompiledArrayType; readonly deque?: boolean; readonly cells?: string; readonly fresh?: boolean };
    function isScalar(value: LoopValue): value is LoopTerm { return typeof value.type === 'string'; }
    interface LoopInput { readonly term: LoopTerm; readonly lines: readonly string[] }
    /** Only a known completion boundary may borrow a deferred scalar result.
     * Sibling calls/reads that can fail must run before the result is demanded. */
    function immediateConsumer(expression: Expression): boolean {
        let node = expression;
        for (;;) {
            const parent = node.$container;
            if (isParenthesizedExpression(parent) || isUnaryExpression(parent)) { node = parent; continue; }
            if (isBinaryExpression(parent)) {
                const other = parent.left === node ? parent.right : parent.left;
                if (isNumberLiteral(other) || isBooleanLiteral(other)
                    || isNameExpression(other) && ['integer', 'real', 'boolean'].includes(knownType(other) ?? '')) {
                    node = parent; continue;
                }
            }
            return isAssignmentStatement(parent) && !parent.deferred && parent.value === node
                || isArrayAssignmentStatement(parent) && parent.value === node;
        }
    }
    function emit(e: Expression, lines: string[], hint?: LoopTerm['type'], tail = false): LoopTerm | undefined {
        // A predicate may read exact counters while array addresses and range
        // geometry retain their independently checked Number dependencies.
        if (numberMode && hint === 'boolean' && state.wideScalars.size
            && [e, ...AstUtils.streamAllContents(e)].some(node => isNameExpression(node) && state.wideScalars.has(node.name))) {
            return createLoopExpressions(state, true).emit(e, lines, hint, tail);
        }

        let tailSource = e;
        while (isParenthesizedExpression(tailSource)) tailSource = tailSource.value;
        const booleanPairs = new Map<Expression, boolean>();
        const types: readonly CompiledLoopType[] = ['integer', 'boolean', 'bytes',
            ...host.textLoops ? ['text' as const] : [], ...host.reals ? ['real' as const] : []];
        const inferred = inferCompiledExpression<CompiledLoopType, LoopInput>(e, {
            atom: type => types.find(candidate => candidate === type),
            substitute: source => {
                const supplied = scalarInputs.get(source);
                if (supplied) return { type: supplied.type, input: { term: supplied, lines: [] } };
                // Collection extrema must precede scalar inference: treating
                // a stored array as a scalar poisons subsequent local types.
                if (numberMode && host.nativeCalls && host.extrema && isApplicationExpression(source)) {
                    const parts = flattenApplication(source), last = parts.at(-1);
                    if (parts.length === 2 && isNameExpression(last) && ['min', 'max'].includes(last.name)
                        && !localTypes.has(last.name) && !arrays.has(last.name) && !containers.has(last.name)
                        && arrayType(parts[0])?.element === 'integer') {
                        const setup: string[] = [], vector = numberVector(parts[0], setup);
                        if (vector) {
                            const index = `extremeIndex${state.serial++}`, result = `extreme${state.serial++}`, body: string[] = [];
                            const value = vector.cell(index, body);
                            if (!value) return undefined;
                            builtins.set(last.name, 'core');
                            state.vectorReductions = true;
                            setup.push(`if (${vector.size} === 0) throw overflow; let ${result} = 0;`,
                                numberVectorLoop(vector.size, index, [...body,
                                    `if (${index} === 0 || ${value.code} ${last.name === 'max' ? '>' : '<'} ${result}) ${result} = ${value.code};`]));
                            return { type: 'integer', input: { term: { code: result, type: 'integer' }, lines: setup } };
                        }
                    }
                }
                // A proved small result can delimit an exact arithmetic island.
                // Ordinary Number inputs keep the existing cheaper lowering.
                if (numberMode && state.integerRanges.narrowing.has(source)
                    && [source, ...AstUtils.streamAllContents(source)].some(node =>
                        isNameExpression(node) && state.wideScalars.has(node.name)
                        || isNumberLiteral(node) && typeof node.value === 'bigint' && !Number.isSafeInteger(Number(node.value)))) {
                    const inputLines: string[] = [];
                    const value = createLoopExpressions(state, true).emit(source, inputLines, 'integer');
                    const bounds = safeIntegerRange(state.integerRanges.values.get(source));
                    if (value?.type === 'integer' && bounds) {
                        state.rangeNarrowing = true;
                        const term: LoopTerm = { code: `Number(${value.code})`, type: 'integer', bounds };
                        return { type: 'integer', input: { term, lines: inputLines } };
                    }
                }
                return undefined;
            },
            read: (source, expected) => {
                // Scalar operators use the shared inference. Loop-specific cell
                // reads, calls and literal powers retain their guarded lowering.
                if (isUnaryExpression(source) || isBinaryExpression(source)
                    && source.operator !== '**' && source.operator !== 'in' && source.operator !== 'notin') return undefined;
                const inputLines: string[] = [];
                const term = emitInput(source, inputLines, expected, tail && source === tailSource);
                return term && isScalar(term) ? { type: term.type, input: { term, lines: inputLines } } : undefined;
            },
            isBound: name => localTypes.has(name) || arrays.has(name) || containers.has(name),
            // Name inputs are registers or entry-guarded values, never calls.
            scalarSlot: () => true,
            extreme: host.extrema ? (name, inputs) => {
                const type = inputs[0];
                if (type !== 'integer' && type !== 'real' || inputs.some(input => input !== type)) return undefined;
                builtins.set(name, 'core');
                return type;
            } : undefined,
            operandHint: (source, index, left) => {
                if (isUnaryExpression(source)) return source.operator === 'not' ? 'boolean' : undefined;
                if (!isBinaryExpression(source)) return undefined;
                if (index === 1) return left === 'text' ? 'text'
                    : booleanPairs.get(source) || left === 'boolean' ? 'boolean' : undefined;
                const text = loopOperatorSignature(source.operator, ['text', 'text'], host.nativeCalls);
                const boolean = loopOperatorSignature(source.operator, ['boolean', 'boolean'], host.nativeCalls);
                const textPair = text && knownType(source.right) === 'text';
                const booleanPair = !!boolean && (!loopOperatorSignature(source.operator, ['integer', 'integer'], host.nativeCalls)
                    || knownType(source.right) === 'boolean');
                booleanPairs.set(source, booleanPair);
                return textPair || text?.result === 'text' && knownType(source.left) === 'text'
                    ? 'text' : booleanPair ? 'boolean' : undefined;
            },
            // Literal powers are handled by the guarded input path. Accepting
            // the generic overload here would bypass guarded runtime lowering.
            operator: (operation, inputs) => {
                if (operation.name === '**') return undefined;
                const signature = loopOperatorSignature(operation.name, inputs, host.nativeCalls);
                return signature?.result === 'real' && !host.reals ? undefined : signature;
            },
            budget: { remaining: 1024 },
        }, hint);
        if (inferred.failure) {
            const fallback = callout(e, lines, hint);
            if (fallback) return fallback;
            return reject(inferred.failure.source, inferred.failure.detail);
        }
        const lowered = lower(inferred.expression, lines);
        if (lowered) return lowered;
        const fallback = callout(e, lines, hint);
        if (fallback) return fallback;
        return reject(e);
    }
    function callout(source: Expression, lines: string[], hint?: LoopTerm['type']): LoopTerm | undefined {
        if (!state.canCallout(source, hint)) return undefined;
        const type = knownType(source) ?? hint;
        if (type !== 'integer' && type !== 'real' && type !== 'boolean') return undefined;
        // Facts about catalogued calls require the same binding guards as
        // inline lowering. Rebound functions must take the ordinary path.
        for (const node of [source, ...AstUtils.streamAllContents(source)]) {
            if (!isNameExpression(node)) continue;
            const operation = findOperation(node.name);
            if (operation) builtins.set(operation.name, operation.module);
        }
        const id = state.callouts.length;
        state.callouts.push({ expression: source, expectedType: type });
        const spilled = [...state.assigned].filter(name => !name.includes('.'));
        for (const name of spilled) {
            const s = slot(name);
            // Callouts only run in the exact backend: integer registers are
            // already BigInts, while Number registers hold real values.
            const val = `r${s}`;
            const wIdx = state.writerNames.indexOf(name);
            if (wIdx >= 0) {
                lines.push(`writers[${wIdx}](${val});`);
            } else {
                const bIdx = state.binderNames.indexOf(name);
                if (bIdx >= 0) {
                    lines.push(`binders[${bIdx}](${val});`);
                }
            }
        }
        const temp = `v${state.serial++}`;
        lines.push(`const ${temp} = callouts[${id}]();`);
        return { code: temp, type };
    }
    function lower(node: CompiledExpression<CompiledLoopType, LoopInput>, lines: string[], selection?: { name: string; count: number }): LoopTerm | undefined {
        if (!temporaryBudget(node.source)) return undefined;
        if (node.kind === 'group') return lower(node.operand, lines);
        if (node.kind === 'literal') {
            const value = node.value;
            if (numberMode && typeof value === 'bigint' && !Number.isSafeInteger(Number(value))) return undefined;
            return { type: node.type, bounds: numberMode && typeof value === 'bigint' ? [Number(value), Number(value)] : undefined, code: typeof value === 'bigint' ? `${value}${numberMode ? '' : 'n'}`
                : typeof value === 'number' ? Object.is(value, -0) ? '-0' : String(value) : JSON.stringify(value) };
        }
        if (node.kind === 'input') {
            const input = node.input;
            if (selection && input.term.selection) {
                // Only the final read belongs to argument preparation; index
                // expressions keep their own errors and evaluation order.
                lines.push(...input.lines.slice(0, -1), `let ${input.term.code}; try {
                    ${input.lines.at(-1)!.replace(`const ${input.term.code} =`, `${input.term.code} =`)}
                } catch (error) { throw argumentSelectionError(error, ${JSON.stringify(selection.name)}, ${selection.count}); }`);
            } else lines.push(...input.lines);
            return node.input.term;
        }
        if (node.kind === 'call') return undefined; // Calls are guarded loop inputs above.
        if (node.kind === 'extreme') {
            const left = lower(node.left, lines, node.selected ? { name: node.name, count: node.selected } : undefined);
            if (!left || !node.right) return left;
            // Cell reads may be accessor expressions. Freeze the left value
            // before lowering the right and use each operand only once.
            const first = `v${state.serial++}`;
            lines.push(`const ${first} = ${left.code};`);
            const right = lower(node.right, lines);
            if (!right) return undefined;
            const second = `v${state.serial++}`, result = `v${state.serial++}`;
            lines.push(`const ${second} = ${right.code};`, `const ${result} = ${scalarExtremeSource(node.name, first, second)};`);
            return { code: result, type: node.type };
        }
        if (node.kind === 'unary') {
            const value = lower(node.operand, lines), token = node.operation.unary;
            if (!value || token === undefined) return undefined;
            return { code: token === '' ? value.code : node.type === 'integer' ? safe(`${token}(${value.code})`) : `${token}(${value.code})`, type: node.type };
        }
        if (numberMode && node.kind === 'binary' && node.operation.name === 'mod' && node.type === 'integer') {
            let product = node.left;
            while (product.kind === 'group') product = product.operand;
            if (product.kind === 'binary' && product.operation.name === '*' && product.type === 'integer') {
                const left = lower(product.left, lines);
                if (!left || left.type !== 'integer') return undefined;
                const a = `mul${state.serial++}`; lines.push(`const ${a} = ${left.code};`);
                const right = lower(product.right, lines);
                if (!right || right.type !== 'integer') return undefined;
                const b = `mul${state.serial++}`; lines.push(`const ${b} = ${right.code};`);
                const modulus = lower(node.right, lines);
                if (!modulus || modulus.type !== 'integer') return undefined;
                const m = `mod${state.serial++}`, result = `v${state.serial++}`;
                const full = `full${state.serial++}`, rem = `rem${state.serial++}`;
                // Large residue domains use the bounded exact multiplier
                // directly; small moduli keep their cheaper safe-product path.
                lines.push(`const ${m} = ${modulus.code}, ${full} = ${a} * ${b}; let ${result};`);
                lines.push(`if (${m} > ${MAX_SAFE_RESIDUE_MODULUS} && ${m} <= 1073741824) { ${result} = mulmod(${a}, ${b}, ${m}); } else if (Number.isSafeInteger(${full})) { if (${m} === 0) throw ${vectorCellDepth ? 'overflow' : 'zero()'};`);
                lines.push(`const ${rem} = ${full} >= 0 && ${full} < 4503599627370496 && ${m} > 0 ? ${full} - Math.floor(${full} / ${m}) * ${m} : ${full} % ${m};`);
                lines.push(`${result} = ${rem} + ((${full} < 0) !== (${m} < 0) && ${rem} !== 0 ? ${m} : 0);`);
                lines.push(`} else { ${result} = mulmod(${a}, ${b}, ${m}); }`);
                return { code: result, type: 'integer' };
            }
        }
        const left = lower(node.left, lines);
        const token = node.operation.binary;
        const guard = token === '&&' || token === '||';
        const rightLines: string[] = guard ? [] : lines;
        const right = lower(node.right, rightLines);
        if (!left || !right || !token) return undefined;
        if (guard) {
            const name = `v${state.serial++}`;
            lines.push(`let ${name} = ${left.code}; if (${node.operation.name === 'and' ? '' : '!'}${name}) { ${rightLines.join('\n')} ${name} = ${right.code}; }`);
            return { code: name, type: node.type };
        }
        const code = arithmetic(node.operation.name, left, right, node.type, lines);
        return code === undefined ? undefined : { code, type: node.type, bounds: node.type === 'integer' ? integerBounds(node.operation.name, left, right) : undefined };
    }
    /** Exact interval arithmetic is a proof about all cells, not a scan.
     * Unknown or unsafe bounds retain the existing checked Number path. */
    function integerBounds(op: string, left: LoopTerm, right: LoopTerm): readonly [number, number] | undefined {
        // Keep the native arithmetic path stable when an operand has no range.
        if (!numberMode || !left.bounds || !right.bounds) return undefined;
        const exact = (bounds: LoopTerm['bounds']): IntegerRange | undefined => bounds && [BigInt(bounds[0]), BigInt(bounds[1])];
        return safeIntegerRange(integerRange(op, exact(left.bounds), exact(right.bounds)));
    }
    /** One checked binary operator. Compound assignments lower through it
     * too, so division by zero and floor rounding are written once. */
    function arithmetic(op: string, left: LoopTerm, right: LoopTerm, type: LoopTerm['type'], lines: string[]): string | undefined {
        const operation = findCompiledOperator(op);
        const token = operation?.binary;
        if (!operation || !token) return undefined;
        const a = left.code, b = right.code, name = `v${state.serial++}`;
        const checked = type === 'integer' && integerBounds(op, left, right) ? (code: string) => code : safe;
        if (op === '/' || left.type === 'real' || right.type === 'real') {
            // The interpreter's coercions: Number for arithmetic, exact
            // bigint/number relations, and `==` for integral equality.
            if (token === '//' || token === '%') return undefined;
            const real = (term: LoopTerm) => term.type === 'integer' ? `Number(${term.code})` : `(${term.code})`;
            const mixed = left.type !== right.type;
            if (op === '/') lines.push(`if (${zeroTestSource(b, right.type === 'integer' && !numberMode ? 'integer' : 'real')}) throw ${vectorCellDepth ? 'overflow' : 'zero()'};`);
            if (op === '**') lines.push(`if (${zeroTestSource(a, left.type === 'integer' && !numberMode ? 'integer' : 'real')} && (${b}) < 0) throw ${vectorCellDepth ? 'overflow' : 'powerZero()'};`);
            lines.push(`const ${name} = ${type === 'boolean' ? binaryOperatorSource(operation, a, b, { mixed }) : binaryOperatorSource(operation, real(left), real(right))};`);
            if (op === '**') lines.push(`if (Number.isNaN(${name})) throw ${vectorCellDepth ? 'overflow' : 'powerDomain()'};`);
            return name;
        }
        const divisor = right.bounds?.[0];
        if (numberMode && type === 'integer' && (op === '//' || op === 'mod')
            && fitsIntegerRepresentation(left.bounds, 'int32')
            && divisor !== undefined && right.bounds![1] === divisor && divisor >= 1 && divisor <= 2147483648
            && (BigInt(divisor) & (BigInt(divisor) - 1n)) === 0n) {
            // Signed shifts implement floor division; the mask gives the
            // nonnegative remainder even for negative Int32 dividends.
            lines.push(`const ${name} = (${a}) ${op === '//' ? `>> ${Math.log2(divisor)}` : `& ${divisor - 1}`};`);
            return name;
        }
        if (token !== '//' && token !== '%') {
            lines.push(`const ${name} = ${type === 'integer' ? checked(binaryOperatorSource(operation, a, b)) : binaryOperatorSource(operation, a, b)};`);
            return name;
        }
        lines.push(`if (${zeroTestSource(b, numberMode ? 'real' : 'integer')}) throw ${vectorCellDepth ? 'overflow' : 'zero()'};`);
        if (numberMode && op === '//') {
            // Inline the bounded case so loop-invariant numerators can hoist
            // its guard and V8 need not inline a helper at every quotient.
            lines.push(`const ${name} = Math.abs(${a}) < 4503599627370496 ? Math.floor((${a}) / (${b})) || 0 : divide(${a}, ${b});`);
            return name;
        }
        const remainder = numberMode || op === 'mod' ? `m${state.serial++}` : undefined;
        if (remainder) {
            // For 0 <= a < 2^52 and b > 0, quotient rounding is < 1/(2*b),
            // too small to cross the next integer. floor(a/b)*b <= a, so its
            // product and the subtraction are exact. Keep % outside this
            // domain, and retain the zero/sign/overflow checks around it.
            const code = numberMode
                ? `(${a}) >= 0 && (${a}) < 4503599627370496 && (${b}) > 0 ? (${a}) - Math.floor((${a}) / (${b})) * (${b}) : (${a}) % (${b})`
                : `(${a}) % (${b})`;
            lines.push(`const ${remainder} = ${code};`);
        }
        lines.push(`const ${name} = ${binaryOperatorSource(operation, a, b, { remainder, number: numberMode, safe: checked })};`);
        return name;
    }
    /** Lower an audited catalogue call. Argument reads remain in source order;
     * runtime binding still checks the module and current builtin on every entry. */
    function emitBuiltinCall(operation: Operation, signature: CompiledCallSignature, operands: readonly Expression[], lines: string[]): LoopTerm | undefined {
        // Only audited scalar natives can run while container state is
        // private. Rank helpers and host/operand callbacks may observe it.
        const privateStateSafe = signature.callbacks === 'none' && !signature.hostFunction
            && !operation.effects?.length;
        // Pure integer-to-text/predicate calls cannot round a numeric result.
        // Keep their operands exact while the surrounding arithmetic stays in
        // checked Number registers. Entry binding still verifies the native.
        const exactConsumer = signature.callbacks === 'none' && !signature.hostFunction
            && signature.inputs.every(type => type === 'integer')
            && (signature.result === 'text' || signature.result === 'boolean');
        if (exactConsumer) operands.forEach(operand => state.exactInputs.add(operand));
        const wideInput = operands.some(operand => [operand, ...AstUtils.streamAllContents(operand)]
            .some(node => isNameExpression(node) && state.wideScalars.has(node.name)));
        if (state.numberMode && exactConsumer && (wide || signature.result === 'text' || wideInput)) {
            const exact = createLoopExpressions(state, true);
            const arguments_: string[] = [];
            for (const operand of operands) {
                const value = exact.emit(operand, lines, 'integer');
                if (value?.type !== 'integer') return undefined;
                arguments_.push(value.code);
            }
            const name = `v${state.serial++}`, index = calls.length;
            calls.push({ name: operation.name, locals: [], stableArrayReads: true, numberSafe: true, privateStateSafe,
                bind: host.prepareBuiltinCall(operation.module, operation.name, signature.inputs, false) });
            lines.push(`const ${name} = calls[${index}](${arguments_.join(',')});`);
            return { code: name, type: signature.result };
        }
        if (numberMode && !wideInput && operation.module === 'bits' && operation.name === 'shr') {
            const arguments_: string[] = [];
            for (const operand of operands) {
                const value = emit(operand, lines, 'integer');
                if (value?.type !== 'integer') return undefined;
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${value.code};`);
                arguments_.push(name);
            }
            builtins.set(operation.name, operation.module);
            const [left, right] = arguments_, name = `v${state.serial++}`;
            // Scaling a safe integer by 2^-K is exact through K=52. At K>=53
            // its magnitude is below one: arithmetic shift gives 0 or -1.
            // Negative counts retain the exact native's validation/replay.
            lines.push(`if (${right} < 0) throw overflow;`,
                `const ${name} = ${right} > 52 ? (${left} < 0 ? -1 : 0) : Math.floor(${left} / (2 ** ${right}));`);
            return { code: name, type: 'integer' };
        }
        if (numberMode && operation.module === 'bits' && ['band', 'bor', 'bxor', 'bit', 'shl'].includes(operation.name)) {
            const arguments_: string[] = [];
            const compact: boolean[] = [];
            for (const operand of operands) {
                const value = emit(operand, lines, 'integer');
                if (value?.type !== 'integer') return undefined;
                const name = `v${state.serial++}`;
                // Shift/test domains retain the existing Int32 guard. Logical
                // bitwise operations can combine both halves of a safe integer.
                const bounded = !!value.bounds && fitsIntegerRepresentation(value.bounds, 'int32');
                compact.push(bounded);
                lines.push(`const ${name} = ${bounded ? value.code : `${['band', 'bor', 'bxor'].includes(operation.name) ? 'safe' : 'int32'}(${value.code})`};`);
                arguments_.push(name);
            }
            builtins.set(operation.name, operation.module);
            const name = `v${state.serial++}`;
            const [left, right] = arguments_;
            if (operation.name === 'bit' || operation.name === 'shl') {
                // JS masks shift counts modulo 32. Unsupported domains replay
                // the exact backend, including its ordinary negative errors.
                lines.push(`if (${right} < 0 || ${right} > 30${operation.name === 'bit' ? ` || ${left} < 0` : ''}) throw overflow;`);
                lines.push(`const ${name} = ${operation.name === 'bit'
                    ? `((${left} & (1 << ${right})) !== 0)` : `safe(${left} * (2 ** ${right}))`};`);
            } else {
                if (compact.every(Boolean)) {
                    const token = ({ band: '&', bor: '|', bxor: '^' } as const)[operation.name as 'band' | 'bor' | 'bxor'];
                    lines.push(`const ${name} = ${left} ${token} ${right};`);
                    return { code: name, type: 'integer', bounds: [-2147483648, 2147483647] };
                }
                lines.push(`const ${name} = safe(${numberBitwiseSource(operation.name as 'band' | 'bor' | 'bxor', left, right)});`);
            }
            return { code: name, type: operation.name === 'bit' ? 'boolean' : 'integer' };
        }
        if (numberMode && (signature.callbacks !== 'none' || signature.hostFunction
            || !['integer', 'real', 'boolean'].includes(signature.result)
            || signature.inputs.some(type => !['integer', 'real', 'boolean', 'number'].includes(type)))) return undefined;
        if (numberMode) builtins.set(operation.name, operation.module);
        const arguments_: string[] = [];
        const types: string[] = [];
        let firstType: LoopTerm['type'] | undefined;
        for (const [index, input] of signature.inputs.entries()) {
            let part = operands[index];
            while (isParenthesizedExpression(part)) part = part.value;
            if (input === 'text-array' || input === 'integer-array') {
                const type = input === 'text-array' ? 'text' : 'integer';
                if (type === 'text' && !host.textArrayLoops || !isNameExpression(part) || part.name.includes('.')) return undefined;
                const previous = arrays.get(part.name);
                if (previous && (previous.rank !== 1 || previous.type !== type)
                    || localTypes.has(part.name)) return undefined;
                const info = previous ?? { slot: slot(part.name), rank: 1, type };
                arrays.set(part.name, info);
                if (!assigned.has(part.name)) arrayInputs.add(part.name);
                arguments_.push(`r${info.slot}`);
                types.push(input);
                continue;
            }
            const expected = input === 'number' || input === 'scalar' ? undefined : input === 'text-or-array' ? 'text' : input === 'same' ? firstType
                : input === 'text-or-bytes' ? knownType(part) ?? (isNameExpression(part) ? 'text' : undefined) : input;
            const value = emit(operands[index], lines, expected);
            if (!value || expected && value.type !== expected
                || input === 'number' && value.type !== 'integer' && value.type !== 'real'
                || input === 'scalar' && !['integer', 'real', 'boolean', 'text'].includes(value.type)
                || input === 'text-or-bytes' && !['text', 'bytes'].includes(value.type)) return undefined;
            firstType ??= value.type;
            arguments_.push(value.code);
            types.push(value.type);
        }
        const name = `v${state.serial++}`, index = calls.length;
        // Catalogue compiled calls are synchronous operations with
        // no Rank callbacks; bind() checks the current builtin.
        calls.push({ name: operation.name, locals: [], stableArrayReads: true, numberSafe: numberMode,
            privateStateSafe: privateStateSafe && types.every(type => ['integer', 'real', 'boolean', 'text'].includes(type)),
            bind: host.prepareBuiltinCall(operation.module, operation.name, types, numberMode) });
        let code = `calls[${index}](${arguments_.join(',')})`;
        // Exact bitsets need no native dispatch per cell. Retain the bound call
        // above as the entry guard; invalid domains use its ordinary errors.
        if (!numberMode && operation.module === 'bits') {
            const [left, right] = arguments_;
            const token = ({ band: '&', bor: '|', bxor: '^' } as Record<string, string>)[operation.name];
            if (token) code = `(${left} ${token} ${right})`;
            if (operation.name === 'bnot') code = `(~${left})`;
            if (operation.name === 'shl' || operation.name === 'shr') {
                code = `(${right} < 0n ? ${code} : (${left} ${operation.name === 'shl' ? '<<' : '>>'} ${right}))`;
            }
            if (operation.name === 'bit') {
                code = `(${left} < 0n || ${right} < 0n ? ${code} : ((${left} & (1n << ${right})) !== 0n))`;
            }
        }
        lines.push(`const ${name} = ${numberMode && signature.result === 'integer' ? safe(code) : code};`);
        return { code: name, type: signature.result };
    }
    /** `A sum axis 0 -1` over integers: any literal axes, as the evaluator takes them.
     * The reduced rank is fixed here; axis errors surface from the evaluator itself. */
    function axisReduction(e: Expression) {
        if (!isApplicationExpression(e) || !host.arrayValues) return undefined;
        const form = applicationForm(e, name => findOperation(name));
        if (form.kind !== 'axis-reduction' || !['sum', 'min', 'max'].includes(form.operation.name)) return undefined;
        const name = form.operation.name;
        if (localTypes.has(name) || arrays.has(name) || containers.has(name)) return undefined;
        const source = arrayType(form.source);
        if (source?.element !== 'integer') return undefined;
        try {
            const label = `${name} axis`;
            const axes = form.axes.map(axis => Number(safeDimension(integerLiteral(axis, label), label)));
            const rank = source.rank - resolveAxes(axes, source.rank, name).length;
            return rank >= 1 ? { form, axes, rank } : undefined;
        } catch { return undefined; }
    }
    /** Completed concatenation owns fresh cells. Lazy concatenations retain
     * their ordinary evaluator and snapshot/demand contracts. */
    function numericConcatCopy(e: Expression) {
        if (!numberMode || !host.arrayLocals || !host.arrayReads || !host.nativeCalls
            || !host.module('sequences') || !isApplicationExpression(e)) return undefined;
        const form = applicationForm(e);
        if (form.kind !== 'array-combine-constructor' || form.operation !== 'concat'
            || form.axis || form.rest.length !== 1 || !isNameExpression(form.rest[0])
            || form.rest[0].name !== 'copy' || localTypes.has('copy') || arrays.has('copy') || containers.has('copy')
            || !form.items.every(isNameExpression)) return undefined;
        const types = form.items.map(arrayType), type = types[0];
        if (!type || type.rank !== 1 || type.element !== 'integer' && !(type.element === 'real' && host.reals)
            || types.some(other => other?.rank !== 1 || other.element !== type.element)) return undefined;
        return { operands: form.items, type };
    }
    function numericReshape(e: Expression) {
        if (!numberMode || !host.nativeCalls || !host.arrayLocals || !host.module('sequences')
            || !isApplicationExpression(e) || localTypes.has('reshape') || arrays.has('reshape') || containers.has('reshape')) return undefined;
        const form = applicationForm(e, name => findOperation(name));
        if (form.kind !== 'reshape' || form.rest.length
            || form.dimensions.some(dimension => !isAllAxisExpression(dimension) && !isNameExpression(dimension) && !isNumberLiteral(dimension)
                && !isParenthesizedExpression(dimension) && !isUnaryExpression(dimension) && !isBinaryExpression(dimension))) return undefined;
        const type = arrayType(form.source);
        return type && ['integer', 'real', 'boolean'].includes(type.element) ? { form, type } : undefined;
    }
    /** Integer prefixes own fresh storage. Bounded modular prefixes can keep
     * tensor axes inside a region without wide intermediates or a second map. */
    function numericScan(e: Expression) {
        if (!numberMode || !host.nativeCalls || !host.arrayLocals || !host.arrayReads
            || localTypes.has('scan') || arrays.has('scan') || containers.has('scan') || host.read('scan') !== undefined) return undefined;
        let source = e;
        while (isParenthesizedExpression(source)) source = source.value;
        const modulus = isBinaryExpression(source) && source.operator === 'mod' ? source.right : undefined;
        if (modulus) {
            // A scalar stored modulus cannot run callbacks before the prefix.
            if (wide || !isNameExpression(modulus) && !isNumberLiteral(modulus) || knownType(modulus) !== 'integer') return undefined;
            source = (source as import('@arrrank/language').BinaryExpression).left;
            while (isParenthesizedExpression(source)) source = source.value;
        }
        try {
            const form = symbolicApplicationForm(source);
            if (form?.kind !== 'scan' || !(form.operator === '+' || modulus && form.operator === '*') || form.rank || form.keys || form.size
                || form.axis && !modulus) return undefined;
            const type = arrayType(form.source);
            if (!type || type.element !== 'integer' || type.rank < 1 || !form.axis && type.rank !== 1
                || form.seed && knownType(form.seed) !== 'integer') return undefined;
            const axis = form.axis ? resolveAxis(Number(safeDimension(integerLiteral(form.axis, 'scan axis'), 'scan axis')), type.rank) : undefined;
            return { form, type, axis, modulus };
        } catch { return undefined; }
    }
    function numericPrimeCopy(expression: Expression) {
        if (!numberMode || !host.nativeCalls || !host.arrayLocals || !host.arrayReads
            || ['copy', 'primes'].some(name => localTypes.has(name) || arrays.has(name)
                || containers.has(name))) return undefined;
        while (isParenthesizedExpression(expression)) expression = expression.value;
        if (!isApplicationExpression(expression) || expression.arguments.length !== 1
            || !isNameExpression(expression.arguments[0]) || expression.arguments[0].name !== 'copy') return undefined;
        const bounds = primeLoopBounds(expression.head);
        return bounds?.some(bound => bound.upper) ? bounds : undefined;
    }
    // A finite range is a sequence until explicitly completed. Array typing
    // also describes vectorizable ranges, so it alone cannot admit indices.
    function completedIndicesMask(expression: Expression): boolean {
        while (isParenthesizedExpression(expression)) expression = expression.value;
        if (isMaterializeExpression(expression)) return true;
        if (isBinaryExpression(expression)) return !['to', 'till'].includes(expression.operator)
            && completedIndicesMask(expression.left) && completedIndicesMask(expression.right);
        if (isUnaryExpression(expression)) return completedIndicesMask(expression.operand);
        if (isApplicationExpression(expression)) {
            if (expression.arguments.length === 1 && isNameExpression(expression.arguments[0])
                && expression.arguments[0].name === 'copy') return true;
            return completedIndicesMask(expression.head) && expression.arguments.every(completedIndicesMask);
        }
        return !AstUtils.streamAllContents(expression).some(node => isBinaryExpression(node)
            && ['to', 'till'].includes(node.operator));
    }
    // Completed external Boolean arrays already have a word-wise indices
    // kernel. Private stages and numeric predicates benefit from this region.
    function privateIndicesMask(expression: Expression, seen = new Set<string>()): boolean {
        while (isParenthesizedExpression(expression)) expression = expression.value;
        if (isNameExpression(expression)) {
            const type = arrays.get(expression.name)?.type
                ?? (seen.size === 0 ? arrayType(expression)?.element : undefined);
            if (type === 'integer' || type === 'real') return true;
            if (type !== 'boolean' || !state.arrayDefinitions.has(expression.name) || seen.has(expression.name)) return false;
            const definitions = [...AstUtils.streamAllContents(state.statement)].filter(node =>
                isAssignmentStatement(node) && node.name === expression.name);
            const nested = new Set(seen).add(expression.name);
            return definitions.length > 0 && definitions.every(node => isAssignmentStatement(node)
                && node.operator === '=' && privateIndicesMask(node.value, nested));
        }
        if (isMaterializeExpression(expression)) return privateIndicesMask(expression.source, seen);
        if (isBinaryExpression(expression)) return ['to', 'till'].includes(expression.operator)
            || privateIndicesMask(expression.left, seen) || privateIndicesMask(expression.right, seen);
        if (isUnaryExpression(expression)) return privateIndicesMask(expression.operand, seen);
        if (isApplicationExpression(expression)) {
            if (expression.arguments.length === 1 && isNameExpression(expression.arguments[0])
                && ['sum', 'len', 'product', 'count', 'min', 'max', 'indices'].includes(expression.arguments[0].name)) return false;
            return privateIndicesMask(expression.head, seen)
                || expression.arguments.some(operand => privateIndicesMask(operand, seen));
        }
        return false;
    }
    function numericMembership(expression: Expression): { name: string; key: Expression; negate: boolean } | undefined {
        if (!numberMode || !host.sequenceMembership || !isBinaryExpression(expression) || expression.step
            || !['in', 'notin'].includes(expression.operator) || !isNameExpression(expression.right)) return undefined;
        const name = expression.right.name;
        if (localTypes.has(name) || arrays.has(name) || containers.has(name) || assigned.has(name)
            || !compiledNumberSequenceMembership(host.read(name))) return undefined;
        return { name, key: expression.left, negate: expression.operator === 'notin' };
    }
    function numberMembershipCall(name: string): number {
        const index = calls.length;
        calls.push({ name, locals: [], stableArrayReads: true, numberSafe: true, privateStateSafe: true,
            bind: () => compiledNumberSequenceMembership(host.read(name)) });
        return index;
    }
    function numericIndices(expression: Expression): Expression | undefined {
        if (!numberMode || !host.nativeCalls || !host.arrayLocals || !host.arrayReads
            || !host.booleanArrays || localTypes.has('indices') || arrays.has('indices')
            || containers.has('indices')) return undefined;
        while (isParenthesizedExpression(expression)) expression = expression.value;
        if (!isApplicationExpression(expression)) return undefined;
        if (expression.arguments.length !== 1 || !isNameExpression(expression.arguments[0])
            || expression.arguments[0].name !== 'indices') return undefined;
        const source = expression.head, type = arrayType(source);
        return type?.rank === 1 && type.element === 'boolean' && completedIndicesMask(source) && privateIndicesMask(source) ? source : undefined;
    }
    function numericCountSlice(expression: Expression) {
        if (!numberMode || !host.arrayLocals || !host.arrayReads || !isCountClauseExpression(expression)
            || !completedIndicesMask(expression.source)) return undefined;
        const type = arrayType(expression.source);
        return type && type.rank > 0 && (type.element === 'integer' || type.element === 'boolean' || type.element === 'real' && host.reals)
            ? { form: expression, type } : undefined;
    }
    function numericReverse(expression: Expression) {
        if (!numberMode || !host.nativeCalls || !host.arrayLocals || !host.arrayReads
            || !host.module('sequences') || !isApplicationExpression(expression)
            || localTypes.has('reverse') || arrays.has('reverse') || containers.has('reverse')) return undefined;
        const parts = flattenApplication(expression);
        if (parts.length !== 2 || !isNameExpression(parts[1]) || parts[1].name !== 'reverse'
            || !completedIndicesMask(parts[0])) return undefined;
        const type = arrayType(parts[0]);
        return type && type.rank > 0 && ['integer', 'real', 'boolean'].includes(type.element)
            ? { source: parts[0], type } : undefined;
    }
    function sortedSearch(source: Expression) {
        while (isParenthesizedExpression(source)) source = source.value;
        if (!numberMode || !host.nativeCalls || !host.arrayReads || !host.module('algo') || !isApplicationExpression(source)) return undefined;
        const parts = flattenApplication(source), word = parts.at(-1);
        if (parts.length !== 3 || !word || !isNameExpression(word) || !['lowerindex', 'upperindex'].includes(word.name)
            || localTypes.has(word.name) || arrays.has(word.name) || containers.has(word.name)) return undefined;
        const input = arrayType(parts[0]), targets = arrayType(parts[1]);
        if (input?.rank !== 1 || !targets || ![input.element, targets.element].every(type => type === 'integer' || type === 'real' && host.reals)) return undefined;
        return { source: parts[0], targets: parts[1], type: targets, name: word.name };
    }
    // Array operands use the same concrete range/selection operations as the
    // evaluator, without re-entering expression evaluation on every iteration.
    function arrayType(e: Expression): CompiledArrayType | undefined {
        while (isParenthesizedExpression(e)) e = e.value;
        if (scalarInputs.has(e) || isNameExpression(e) && state.ranges.has(e.name)) return undefined;
        if (numberMode && isMaterializeExpression(e)) return arrayType(e.source);
        if (numericPrimeCopy(e) || numericIndices(e)) return { kind: 'array', element: 'integer', rank: 1 };
        const countSlice = numericCountSlice(e);
        if (countSlice) return countSlice.type;
        const reverse = numericReverse(e);
        if (reverse) return reverse.type;
        const membership = numericMembership(e);
        if (membership) {
            const input = arrayType(membership.key);
            if (input?.element === 'integer') return { ...input, element: 'boolean' };
        }
        const scan = numericScan(e);
        if (scan) return scan.type;
        const concat = numericConcatCopy(e);
        if (concat) return concat.type;
        const reshape = numericReshape(e);
        if (reshape) return { ...reshape.type, rank: reshape.form.dimensions.length };
        const search = sortedSearch(e);
        if (search) return { kind: 'array', element: 'integer', rank: search.type.rank };
        if (numberMode && isTableFilterExpression(e) && e.condition && !e.conditions.length && !e.sourceFields.length) {
            const source = arrayType(e.source), mask = arrayType(e.condition);
            if (source && source.rank > 0 && ['integer', 'real', 'boolean'].includes(source.element)
                && mask?.rank === source.rank && mask.element === 'boolean') return { ...source, rank: 1 };
        }
        if (!numberMode && host.booleanArrays && isBinaryExpression(e)
            && ['equal', 'notequal', 'less', 'greater', 'atmost', 'atleast'].includes(e.operator)) {
            const left = arrayType(e.left), right = arrayType(e.right);
            if ((left || right) && (!left || left.element === 'integer') && (!right || right.element === 'integer'))
                return { kind: 'array', element: 'boolean', rank: Math.max(left?.rank ?? 0, right?.rank ?? 0) };
        }
        if (!numberMode) {
            const call = arrayCall(e);
            if (call) return call.type;
        }
        if (numberMode) {
            const point = vectorOperation(e);
            if (point) {
                const operands = point.operands.map(arrayType);
                if (operands.some(Boolean)) {
                    const types = operands.map((type, i) => type?.element ?? knownType(point.operands[i]) ?? 'integer');
                    const type = point.unary ? point.unary.types[types[0]]
                        : point.fusedProduct ? types.every(type => type === 'integer') ? 'integer' : undefined
                        : point.name === 'choose'
                        ? types[0] === 'boolean' && types[1] === types[2] ? types[1] : undefined
                        : point.name === 'min' || point.name === 'max'
                        ? types.every(type => type === types[0]) && (types[0] === 'integer' || types[0] === 'real') ? types[0] : undefined
                        : point.module ? types.every(type => type === 'integer') ? point.name === 'bit' ? 'boolean' : 'integer' : undefined
                        : loopOperatorSignature(point.name, types, host.nativeCalls === true)?.result;
                    if (type === 'integer' || type === 'boolean' || type === 'real' && host.reals) {
                        return { kind: 'array', element: type, rank: Math.max(...operands.map(type => type?.rank ?? 0)) };
                    }
                }
            }
        }
        if (isNameExpression(e) && !e.name.includes('.') && !localTypes.has(e.name)) {
            const previous = arrays.get(e.name);
            if (previous && previous.type !== 'bytes') return { kind: 'array', element: previous.type, rank: previous.rank };
            const current = host.read(e.name);
            const kinds = current && isRankArray(current) ? storedScalarKinds(current) : undefined;
            if (current && isRankArray(current) && kinds && (kinds.length === 0 || kinds.join() === 'integer')) {
                return { kind: 'array', element: 'integer', rank: current.shape.length };
            }
            if (host.booleanArrays && current && isRankArray(current) && kinds?.join() === 'boolean') {
                return { kind: 'array', element: 'boolean', rank: current.shape.length };
            }
            if (numberMode && host.reals && current && isRankArray(current) && kinds?.join() === 'real') {
                return { kind: 'array', element: 'real', rank: current.shape.length };
            }
        }
        if (isBinaryExpression(e) && ['to', 'till'].includes(e.operator)) {
            return { kind: 'array', element: 'integer', rank: 1 };
        }
        if (isBinaryExpression(e) && ['+', '-', '*', '//', 'mod'].includes(e.operator)) {
            const left = arrayType(e.left), right = arrayType(e.right);
            if ((left || right) && (!left || left.element === 'integer') && (!right || right.element === 'integer')) {
                return { kind: 'array', element: 'integer', rank: Math.max(left?.rank ?? 0, right?.rank ?? 0) };
            }
        }
        const reduction = axisReduction(e);
        if (reduction) return { kind: 'array', element: 'integer', rank: reduction.rank };
        if (isApplicationExpression(e)) {
            const parts = flattenApplication(e), last = parts.at(-1)!;
            if (parts.length >= 2 && isNameExpression(last) && last.name === 'copy'
                && host.nativeCalls && !localTypes.has('copy') && !arrays.has('copy') && !containers.has('copy')) {
                return arrayType(applicationExpression(parts.slice(0, -1), e));
            }
            if (parts.length === 2) {
                const source = arrayType(parts[0]), selector = arrayType(last);
                if (source && selector?.element === 'integer') return { ...source, rank: source.rank + selector.rank - 1 };
                if (numberMode && source && source.rank > 1 && knownType(last) === 'integer') return { ...source, rank: source.rank - 1 };
                if (numberMode && source?.rank === 1 && isRange(last)) return source;
                if (host.booleanArrays && source && source.rank > 0 && selector?.rank === source.rank
                    && selector.element === 'boolean') return { ...source, rank: 1 };
            }
        }
        return undefined;
    }
    /** Array-valued native calls retain the evaluator's broadcasting and
     * demand semantics; this compiles dispatch, not a fused element loop. */
    function arrayCall(e: Expression) {
        if (!host.nativeCalls || !isApplicationExpression(e)) return undefined;
        const parts = flattenApplication(e), word = parts.at(-1);
        if (!word || !isNameExpression(word) || localTypes.has(word.name) || arrays.has(word.name) || containers.has(word.name)) return undefined;
        const name = word.name;
        if (!(host.extrema && ['min', 'max'].includes(name) && parts.length === 3
            || host.booleanArrays && name === 'choose' && parts.length === 4)) return undefined;
        const operands = parts.slice(0, -1), types = operands.map(arrayType);
        const elements = operands.map((operand, i) => types[i]?.element ?? knownType(operand));
        const branches = name === 'choose' ? elements.slice(1) : elements;
        if (name === 'choose' && types[0]?.element !== 'boolean' || !types.some(Boolean)
            || !branches.every(type => type === 'integer')) return undefined;
        return { name, operands, type: { kind: 'array' as const, element: 'integer' as const,
            rank: Math.max(...types.map(type => type?.rank ?? 0)) } };
    }
    function emitArrayValue(e: Expression, lines: string[]): LoopValue | undefined {
        while (isParenthesizedExpression(e)) e = e.value;
        const type = arrayType(e);
        if (!type) return undefined;
        if (isNameExpression(e)) {
            const info = arrays.get(e.name) ?? { slot: slot(e.name), rank: type.rank, type: type.element };
            arrays.set(e.name, info);
            if (!assigned.has(e.name)) arrayInputs.add(e.name);
            return { code: `r${info.slot}`, type };
        }
        let code: string;
        const reduction = axisReduction(e);
        const call = arrayCall(e);
        if (call) {
            const operands = call.operands.map(operand => emitValue(operand, lines));
            if (operands.some(value => !value)) return undefined;
            builtins.set(call.name, 'core');
            code = `arrayValues.call(${JSON.stringify(call.name)}, [${operands.map(value => value!.code).join(',')}])`;
        } else if (reduction) {
            const input = emitValue(reduction.form.source, lines);
            if (!input || typeof input.type === 'string' || input.type.element !== 'integer') return undefined;
            const { name, module } = reduction.form.operation;
            builtins.set(name, module);
            code = `arrayValues.reduceAxis(${JSON.stringify(name)}, ${input.code}, [${reduction.axes.join(',')}])`;
        } else if (isBinaryExpression(e) && ['to', 'till'].includes(e.operator)) {
            const start = emit(e.left, lines, 'integer'), end = emit(e.right, lines, 'integer');
            const step = e.step ? emit(e.step, lines, 'integer') : undefined;
            if (start?.type !== 'integer' || end?.type !== 'integer' || e.step && step?.type !== 'integer') return undefined;
            code = `arrayValues.range(${start.code}, ${end.code}, ${e.operator === 'to'}, ${step?.code ?? 'undefined'})`;
        } else if (isBinaryExpression(e)) {
            const left = emitValue(e.left, lines, 'integer'), right = emitValue(e.right, lines, 'integer');
            if (!left || !right || (typeof left.type === 'string' ? left.type : left.type.element) !== 'integer'
                || (typeof right.type === 'string' ? right.type : right.type.element) !== 'integer') return undefined;
            code = `arrayValues.binary(${JSON.stringify(e.operator)}, ${left.code}, ${right.code})`;
        } else if (isApplicationExpression(e)) {
            const parts = flattenApplication(e), last = parts.at(-1)!;
            const copied = isNameExpression(last) && last.name === 'copy';
            const source = copied ? applicationExpression(parts.slice(0, -1), e) : parts[0];
            const selector = last;
            const inputLines: string[] = [];
            const input = emitValue(source, inputLines);
            if (!input || typeof input.type === 'string') return undefined;
            let inputCode = input.code;
            if (copied && parts.length > 2) {
                inputCode = `receiver${state.serial++}`;
                lines.push(`let ${inputCode}; try { ${inputLines.join('\n')} ${inputCode} = ${input.code}; }
                    catch (error) { throw argumentSelectionError(error, 'copy', ${parts.length - 1}); }`);
            } else lines.push(...inputLines);
            if (copied) {
                builtins.set('copy', 'sequences');
                code = `arrayValues.copy(${inputCode})`;
            } else {
                const index = emitValue(selector, lines);
                if (!index || typeof index.type === 'string'
                    || index.type.element !== 'integer' && index.type.element !== 'boolean') return undefined;
                code = `arrayValues.select(${input.code}, ${index.code})`;
            }
        } else return undefined;
        const name = `v${state.serial++}`;
        lines.push(`const ${name} = ${code};`);
        return { code: name, type };
    }
    /** Existing dense integer kernels prove bounds and avoid per-cell safe
     * checks. On multidimensional +,-,* they beat the generic Number region
     * (see numeric-array-stages-results.md). Keep that backend unless this
     * region already needs private vector stages; mixed-real expressions and
     * operators such as gcd still use the new path. */
    function existingIntegerArrayArithmetic(source: Expression): boolean {
        while (isParenthesizedExpression(source)) source = source.value;
        return isNameExpression(source) || isNumberLiteral(source)
            || isUnaryExpression(source) && ['+', '-'].includes(source.operator) && existingIntegerArrayArithmetic(source.operand)
            || isBinaryExpression(source) && !source.step && ['+', '-', '*'].includes(source.operator)
                && existingIntegerArrayArithmetic(source.left) && existingIntegerArrayArithmetic(source.right);
    }
    function numberVectorLoop(size: string, index: string, body: readonly string[], exitLabel?: string, start = '0'): string {
        state.numberVectors = true;
        const block = `block${state.serial++}`, end = `end${state.serial++}`;
        // Keep the hot vector traversal separate from the surrounding binding
        // transaction. V8 can optimize it without exiting an OSR inner loop
        // into scalar moves and exact accumulator updates on every vector.
        return `(() => { ${exitLabel ? `${exitLabel}:` : ''} for (let ${block} = ${start}; ${block} < ${size}; ${block} += vectorStep) {
            const ${end} = Math.min(${size}, ${block} + vectorStep);
            ${state.workCounting ? `work += ${end} - ${block};` : ''}
            checkpoint(undefined, ${end} - ${block});
            for (let ${index} = ${block}; ${index} < ${end}; ${index}++) { ${body.join('\n')} }
        } })();`;
    }
    function vectorOperation(e: Expression): { name: string; operands: Expression[]; module?: string; fusedProduct?: boolean; unary?: InlineBuiltin } | undefined {
        const unwrap = (value: Expression) => { while (isParenthesizedExpression(value)) value = value.value; return value; };
        if (isUnaryExpression(e) && e.operator === 'not') return { name: 'not', operands: [unwrap(e.operand)] };
        if (isBinaryExpression(e) && e.operator === 'mod' && !e.step) {
            const product = unwrap(e.left);
            if (isBinaryExpression(product) && product.operator === '*') {
                const operands = [product.left, product.right, e.right].map(unwrap);
                if (operands.every(operand => (arrayType(operand)?.element ?? knownType(operand) ?? 'integer') === 'integer')) {
                    // Expose the product leaves together. Computing a checked
                    // product cell first would overflow before scalar mulmod.
                    return { name: 'mod', operands, fusedProduct: true };
                }
            }
        }
        if (isBinaryExpression(e) && !e.step && ['+', '-', '*', '**', '/', '//', 'mod', 'equal', 'notequal', 'less', 'greater', 'atmost', 'atleast', 'and', 'or'].includes(e.operator)) {
            return { name: e.operator, operands: [e.left, e.right].map(unwrap) };
        }
        if (host.nativeCalls && isApplicationExpression(e)) {
            const tail = e.arguments.length === 1 ? e.arguments[0] : undefined;
            if (tail && isNameExpression(tail)
                && !localTypes.has(tail.name) && !arrays.has(tail.name) && !containers.has(tail.name)) {
                const builtin: InlineBuiltin | undefined = inlineBuiltins.get(tail.name)
                    ?? (tail.name === 'integer' ? { module: 'core', types: { boolean: 'integer', integer: 'integer' },
                        code: (value, type) => type === 'boolean' ? `(${value} ? 1 : 0)` : value } : undefined);
                if (builtin && (builtin.enabled?.(host) ?? true)) {
                    return { name: tail.name, module: builtin.module, operands: [unwrap(e.head)], unary: builtin };
                }
            }
            e = groupedUnaryDyadicChain(e, name => !localTypes.has(name)
                && !arrays.has(name) && !containers.has(name)) ?? e;
            const parts = flattenApplication(e), last = parts.at(-1);
            if (parts.length === 4 && isNameExpression(last)
                && (last.name === 'powmod' || host.booleanArrays && last.name === 'choose')
                && !localTypes.has(last.name) && !arrays.has(last.name) && !containers.has(last.name)) {
                return { name: last.name, module: last.name === 'choose' ? 'core' : 'numbers',
                    operands: parts.slice(0, -1).map(unwrap) };
            }
            if (parts.length === 3 && isNameExpression(last)
                && !localTypes.has(last.name) && !arrays.has(last.name) && !containers.has(last.name)) {
                // Share the scalar native guards and replay rules with vector
                // cells; in particular, bitwise Number operations retain their
                // Int32 checks instead of silently truncating wider integers.
                const module = last.name === 'gcd' ? 'numbers'
                    : host.extrema && (last.name === 'min' || last.name === 'max') ? 'core'
                    : ['band', 'bor', 'bxor', 'bit', 'shl', 'shr'].includes(last.name) ? 'bits' : undefined;
                if (module) return { name: last.name, module, operands: parts.slice(0, -1).map(unwrap) };
            }
        }
        return undefined;
    }
    /** Pointwise cells share scalar lowering, but scalar subexpressions are
     * captured once, even on empty vectors. A zero divisor replays the original
     * region so nested array errors keep their ordinary evaluation order. */
    function numberVector(source: Expression, lines: string[], inlineRanges = false): NumberVector | undefined {
        let e = source;
        while (isParenthesizedExpression(e)) e = e.value;
        if (inlineRanges && isRange(e)) {
            const zeroOrigin = isBinaryExpression(e) && isNumberLiteral(e.left) && e.left.value === 0n
                && (!e.step || isNumberLiteral(e.step) && e.step.value === 1n);
            const range = rangeOperands(e, lines);
            if (!range) return undefined;
            const { start: first, end: last, step: stride, inclusive } = range;
            const id = state.serial++, start = `start${id}`, end = `end${id}`, step = `step${id}`;
            const distance = `distance${id}`, size = `length${id}`;
            // A consumed progression needs bounds, not a temporary vector.
            // Unsafe distances/cells replay the ordinary exact consumer.
            lines.push(`const ${start} = ${first.code}, ${end} = ${last.code}, ${step} = ${stride.code};
                if (${step} === 0) throw overflow;
                const ${distance} = safe(${step} > 0 ? ${end} - ${start} : ${start} - ${end});
                const ${size} = ${distance} < 0 || (${!inclusive} && ${distance} === 0) ? 0
                    : safe(divide(${inclusive ? distance : `safe(${distance} - 1)`}, Math.abs(${step})) + 1);`);
            return { size, shape: `[${size}]`, rank: 1, type: 'integer', sources: [],
                compactGuards: zeroOrigin ? [`${size} <= 2147483648`] : [], cell: (index, body, frame) => {
                // Multidimensional trailing-axis addressing retains the
                // existing backend until a progression has an axis layout.
                if (frame && frame.rank > 1) return undefined;
                const position = frame ? `(${size} === 1 ? 0 : ${index})` : index;
                // An admitted 0..count-1 progression is its own coordinate;
                // no per-cell multiply/add or safe-integer checks are needed.
                if (zeroOrigin) return { code: position, type: 'integer',
                    bounds: frame?.compact ? [0, 2147483647] : undefined };
                const value = `rangeCell${state.serial++}`;
                body.push(`const ${value} = safe(${start} + safe(${position} * ${step}));`);
                return { code: value, type: 'integer' };
            } };
        }
        const type = arrayType(e);
        if (!type) {
            if (!(isNameExpression(e) || isNumberLiteral(e) || isBooleanLiteral(e) || isUnaryExpression(e) || isBinaryExpression(e))) return undefined;
            const scalar = emit(e, lines);
            if (!scalar || scalar.type !== 'integer' && scalar.type !== 'boolean' && scalar.type !== 'real') return undefined;
            const captured = `scalar${state.serial++}`;
            lines.push(`const ${captured} = ${scalar.code};`);
            return { size: '1', shape: '[]', rank: 0, type: scalar.type, sources: [],
                compactGuards: scalar.type === 'integer' ? [`typeof ${captured} === 'number' && ${captured} === (${captured} | 0)`] : [],
                cell: (_index, _body, frame) => ({ code: captured, type: scalar.type,
                    bounds: frame?.compact && scalar.type === 'integer' ? [-2147483648, 2147483647] : scalar.bounds }) };
        }
        if (type.element !== 'integer' && type.element !== 'boolean' && type.element !== 'real') return undefined;
        const search = sortedSearch(e);
        if (search) {
            const input = emitNumberArray(search.source, lines);
            if (!input || typeof input.type === 'string') return undefined;
            const cells = input.cells ?? `${input.code}.cells`, hint = `searchHint${state.serial++}`;
            lines.push(`vectorLive.push(${cells});`);
            const targets = numberVector(search.targets, lines, inlineRanges);
            if (!targets) return undefined;
            lines.push(`vectorLive.pop(); const ${hint} = { answer: 0 };`);
            builtins.set(search.name, 'algo');
            return { size: targets.size, shape: targets.shape, rank: targets.rank, type: 'integer',
                sources: [...new Set([cells, ...targets.sources])],
                compactGuards: [`${cells}.length <= 2147483647`, ...targets.compactGuards],
                cell: (index, body, frame) => {
                    const target = targets.cell(index, body, frame);
                    if (!target) return undefined;
                    const result = `searchCell${state.serial++}`;
                    if (state.workCounting) body.push(`work += Math.ceil(Math.log2(${cells}.length + 1));`);
                    body.push(`const ${result} = sortedIndexBatch(${cells}, ${target.code}, ${search.name === 'upperindex'}, ${hint});`);
                    return { code: result, type: 'integer', bounds: frame?.compact ? [0, 2147483647] : undefined };
                } };
        }
        const membership = numericMembership(e);
        if (membership) {
            const input = numberVector(membership.key, lines, inlineRanges);
            if (!input || input.type !== 'integer') return undefined;
            const call = numberMembershipCall(membership.name);
            return { ...input, type: 'boolean', cell: (index, body, frame) => {
                const key = input.cell(index, body, frame);
                if (!key) return undefined;
                return { code: `${membership.negate ? '!' : ''}calls[${call}](${key.code})`, type: 'boolean' };
            } };
        }
        // A scan is encoded with its operator token in a binary AST, but
        // owns a completed prefix. It is not pointwise arithmetic on `scan`.
        const point = numericScan(e) ? undefined : vectorOperation(e);
        if (point) {
            const inputs: NumberVector[] = [];
            for (const operand of point.operands) {
                const input = numberVector(operand, lines, inlineRanges);
                if (!input) return undefined;
                inputs.push(input);
                // A later operand may allocate pooled gathers. Keep earlier
                // temporary leaves alive until all operands are prepared.
                if (input.sources.length) lines.push(`vectorLive.push(${input.sources.join(',')});`);
            }
            if (point.fusedProduct && inputs.some(input => input.type !== 'integer')) return undefined;
            const pinned = inputs.reduce((count, input) => count + input.sources.length, 0);
            if (pinned) lines.push(`vectorLive.length -= ${pinned};`);
            if (point.module) builtins.set(point.name, point.module);
            const size = `length${state.serial++}`;
            let shape: string;
            if (type.rank <= 1) {
                lines.push(`let ${size} = 1;`);
                for (const input of inputs) lines.push(`if (${size} !== ${input.size} && ${size} !== 1 && ${input.size} !== 1) throw overflow; ${size} = ${size} === 1 ? ${input.size} : ${size};`);
                shape = `[${size}]`;
            } else {
                shape = inputs[0].shape;
                let layout = '';
                for (const input of inputs.slice(1)) {
                    layout = `layout${state.serial++}`;
                    lines.push(`const ${layout} = vectorLayout(${shape}, ${input.shape});`);
                    shape = `${layout}.shape`;
                }
                lines.push(`const ${size} = ${layout ? `${layout}.size` : inputs[0].size};`);
            }
            return { size, shape, rank: type.rank, type: type.element, sources: [...new Set(inputs.flatMap(input => input.sources))],
                compactGuards: [...new Set(inputs.flatMap(input => input.compactGuards))], cell: (index, body, frame) => {
                // Trailing broadcasting composes: address each original leaf
                // directly in the final frame, rather than remapping indices
                // through every intermediate pointwise expression.
                const root = frame ?? { shape, rank: type.rank, offsets: new Map<string, string>(), values: new Map<string, LoopTerm>() };
                const values = inputs.map(input => input.cell(index, body, root));
                if (values.some(value => !value)) return undefined;
                const previous = point.operands.map(operand => scalarInputs.get(operand));
                point.operands.forEach((operand, i) => scalarInputs.set(operand, values[i]!));
                vectorCellDepth++;
                try {
                    // Grouped dyadic calls can contain new AST nodes. Lower
                    // the exact operands whose scalar cell slots we supplied.
                    if (point.name === 'choose') {
                        // All three cells were evaluated above; choose is eager.
                        return { type: values[1]!.type,
                            code: `(${values[0]!.code} ? ${values[1]!.code} : ${values[2]!.code})` };
                    }
                    if (point.unary) {
                        const value = values[0]!, type = point.unary.types[value.type];
                        if (!type) return undefined;
                        // Replay a vector domain failure through the ordinary
                        // mapper to retain its argument/error attribution.
                        const test = point.unary.domain?.test(value.code, value.type);
                        if (test) body.push(`if (${test}) throw overflow;`);
                        const result = `unary${state.serial++}`;
                        body.push(`const ${result} = ${point.unary.code(value.code, value.type, true)};`);
                        return { type, code: result };
                    }
                    if (point.name === 'powmod') {
                        // Domain failures must replay the ordinary array call,
                        // including its operand/error attribution.
                        body.push(`if (${values[1]!.code} < 0 || ${values[2]!.code} <= 0) throw overflow;`);
                    }
                    if (point.module === 'core' && (point.name === 'min' || point.name === 'max')) {
                        return { type: values[0]!.type,
                            code: scalarExtremeSource(point.name, values[0]!.code, values[1]!.code) };
                    }
                    if (point.module) {
                        const operation = findOperation(point.name)!;
                        const signature = matchCompiledCallSignature(operation, values.map(value => value!.type));
                        return signature ? emitBuiltinCall(operation, signature, point.operands, body) : undefined;
                    }
                    return emit(e, body);
                }
                finally {
                    vectorCellDepth--;
                    point.operands.forEach((operand, i) => previous[i] ? scalarInputs.set(operand, previous[i]!) : scalarInputs.delete(operand));
                }
            } };
        }
        if (isApplicationExpression(e)) {
            const parts = flattenApplication(e);
            if (parts.length === 2 && arrayType(parts[0])?.rank === 1
                && (arrayType(parts[1])?.element === 'integer' || isRange(parts[1]))) {
                // Inline gathers are recipe leaves for a surrounding map.
                // A named gather still completes through emitNumberArray.
                const source = emitNumberArray(parts[0], lines);
                if (!source || typeof source.type === 'string') return undefined;
                const cells = source.cells ?? `${source.code}.cells`;
                lines.push(`vectorLive.push(${cells});`);
                const keys = numberVector(parts[1], lines, true);
                if (!keys || keys.type !== 'integer') return undefined;
                lines.push('vectorLive.pop();');
                return { size: keys.size, shape: keys.shape, rank: keys.rank, type: type.element,
                    sources: [...new Set([cells, ...keys.sources])],
                    compactGuards: [`compactVector(${cells}, ${source.code}.shape)`, ...keys.compactGuards],
                    cell: (index, body, frame) => {
                        const key = keys.cell(index, body, frame);
                        if (key?.type !== 'integer') return undefined;
                        body.push(`if (${key.code} < 0 || ${key.code} >= ${cells}.length) throw overflow;`);
                        const value = `gathered${state.serial++}`;
                        body.push(`const ${value} = ${type.element === 'boolean' ? `${cells}[${key.code}] !== 0`
                            : frame?.compact ? `${cells}[${key.code}]` : type.element === 'real'
                                ? `Number(${cells}[${key.code}])` : `safe(Number(${cells}[${key.code}]))`};`);
                        return { code: value, type: type.element,
                            bounds: frame?.compact && type.element === 'integer' ? [-2147483648, 2147483647] : undefined };
                    } };
            }
        }
        let cells: string, shape: string;
        if (isNameExpression(e)) {
            const info = arrays.get(e.name) ?? { slot: slot(e.name), rank: type.rank, type: type.element };
            arrays.set(e.name, info);
            if (!assigned.has(e.name)) arrayInputs.add(e.name);
            cells = `cells${info.slot}`;
            shape = `r${info.slot}.shape`;
        } else {
            const value = emitNumberArray(e, lines);
            if (!value || typeof value.type === 'string') return undefined;
            cells = value.cells ?? `${value.code}.cells`;
            shape = `${value.code}.shape`;
        }
        const size = `length${state.serial++}`;
        lines.push(`const ${size} = ${cells}.length;`);
        return { size, shape, rank: type.rank, type: type.element, sources: [cells], compactGuards: [`compactVector(${cells}, ${shape})`], cell: (index, body, frame) => {
            const key = `${cells}:${index}`;
            const previous = frame?.values.get(key);
            if (previous) return previous;
            let position = index;
            if (frame && frame.rank <= 1) position = `(${size} === 1 ? 0 : ${index})`;
            else if (frame) {
                const key = `${cells}:${index}`;
                const previous = frame.offsets.get(key);
                if (previous) position = previous;
                else {
                    const layout = `leaf${state.serial++}`;
                    lines.push(`const ${layout} = vectorLayout(${frame.shape}, ${shape});`);
                    const terms = Array.from({ length: type.rank }, (_, axis) => {
                        const aligned = frame.rank - type.rank + axis, stride = `${layout}.right[${aligned}]`;
                        return `(${stride} === 0 ? 0 : (Math.floor(${index} / ${layout}.strides[${aligned}]) % ${frame.shape}[${aligned}]) * ${stride})`;
                    });
                    position = `offset${state.serial++}`;
                    const block = `(${layout}.rightBlock === 1 ? ${index} : Math.floor(${index} / ${layout}.rightBlock))`;
                    body.push(`const ${position} = ${layout}.rightLinear ? ${index} : ${layout}.rightBlock
                        ? (${layout}.rightPeriod === 1 ? 0 : ${layout}.rightPeriod ? ${block} % ${layout}.rightPeriod : ${block})
                        : ${terms.join(' + ')};`);
                    frame.offsets.set(key, position);
                }
            }
            // A pointwise cell never mutates its inputs. Freeze each leaf once
            // before arithmetic expands it into division/remainder guards.
            const value = `cellValue${state.serial++}`;
            body.push(`const ${value} = ${type.element === 'boolean' ? `(${cells}[${position}] !== 0)`
                : type.element === 'real' ? `Number(${cells}[${position}])` : frame?.compact ? `${cells}[${position}]` : `safe(Number(${cells}[${position}]))`};`);
            const term: LoopTerm = { code: value, type: type.element, bounds: frame?.compact && type.element === 'integer' ? [-2147483648, 2147483647] : undefined };
            frame?.values.set(key, term);
            return term;
        } };
    }
    function isRange(source: Expression): boolean {
        while (isParenthesizedExpression(source)) source = source.value;
        return isBinaryExpression(source) && ['to', 'till'].includes(source.operator)
            || isNameExpression(source) && assigned.has(source.name) && state.ranges.has(source.name);
    }
    function rangeOperands(source: Expression, lines: string[]) {
        while (isParenthesizedExpression(source)) source = source.value;
        if (isNameExpression(source) && assigned.has(source.name) && state.ranges.has(source.name)) {
            const code = `r${slot(source.name)}`;
            return { start: { code: `${code}.start`, type: 'integer' as const },
                end: { code: `${code}.end`, type: 'integer' as const },
                step: { code: `${code}.step`, type: 'integer' as const }, inclusive: state.ranges.get(source.name) === 'to' };
        }
        if (!isBinaryExpression(source) || !['to', 'till'].includes(source.operator)) return undefined;
        const start = emit(source.left, lines, 'integer'), end = emit(source.right, lines, 'integer');
        const step = source.step ? emit(source.step, lines, 'integer') : { code: '1', type: 'integer' as const };
        if (start?.type !== 'integer' || end?.type !== 'integer' || step?.type !== 'integer') return undefined;
        return { start, end, step, inclusive: source.operator === 'to' };
    }
    function emitNumberArray(source: Expression, lines: string[]): LoopValue | undefined {
        let countSource = source;
        while (isParenthesizedExpression(countSource)) countSource = countSource.value;
        if (isApplicationExpression(countSource)) {
            const parts = flattenApplication(countSource), type = parts.length === 2 ? arrayType(parts[0]) : undefined;
            if (type && type.rank > 1 && knownType(parts[1]) === 'integer' && !arrayType(parts[1])) {
                state.numberVectors = true;
                const input = emitNumberArray(parts[0], lines);
                if (!input || typeof input.type === 'string') return undefined;
                const cells = input.cells ?? `${input.code}.cells`;
                lines.push(`vectorLive.push(${cells});`);
                const index = emit(parts[1], lines, 'integer');
                if (index?.type !== 'integer') return undefined;
                lines.push('vectorLive.pop();');
                state.syntax.add('scalar-row-selection');
                const row = `row${state.serial++}`, shape = `rowShape${state.serial++}`;
                const size = `rowSize${state.serial++}`, result = `rowResult${state.serial++}`, cell = `rowCell${state.serial++}`;
                lines.push(`const ${row} = ${index.code}; if (${row} < 0 || ${row} >= ${input.code}.shape[0]) throw overflow;
                    const ${shape} = ${input.code}.shape.slice(1), ${size} = ${shape}.reduce((a,b) => safe(a*b), 1);
                    const ${result} = vectorArray(${shape}, ${type.element === 'real'}, vectorPool, vectorLive, [result, iterationResult, ${cells}], ${type.element === 'boolean'});
                    ${numberVectorLoop(size, cell, [`${result}.store(${cell}, ${cells}[${row} * ${size} + ${cell}]);`])}`);
                return { code: result, cells: `${result}.cells`, type: { ...type, rank: type.rank - 1 }, fresh: true };
            }
        }
        const reverse = numericReverse(countSource);
        if (reverse) {
            state.numberVectors = true;
            const input = emitNumberArray(reverse.source, lines);
            if (!input || typeof input.type === 'string') return undefined;
            builtins.set('reverse', 'sequences');
            state.syntax.add('reverse');
            const cells = input.cells ?? `${input.code}.cells`, result = `reverse${state.serial++}`;
            const shape = `reverseShape${state.serial++}`, width = `reverseWidth${state.serial++}`;
            const index = `reverseCell${state.serial++}`;
            // Reverse the leading axis, preserving each trailing cell block.
            // Complete fresh storage so later source/result writes are separate.
            lines.push(`const ${shape} = ${input.code}.shape;
                const ${width} = ${shape}.slice(1).reduce((a,b) => safe(a*b), 1);
                const ${result} = vectorArray([...${shape}], ${input.type.element === 'real'}, vectorPool, vectorLive, [result, iterationResult, ${cells}], ${input.type.element === 'boolean'});
                ${numberVectorLoop(`${cells}.length`, index, [
                    `${result}.store(${index}, ${cells}[(${shape}[0] - 1 - Math.floor(${index} / ${width})) * ${width} + ${index} % ${width}]);`,
                ])}`);
            return { code: result, cells: `${result}.cells`, type: input.type, fresh: true };
        }
        const countSlice = numericCountSlice(countSource);
        if (countSlice) {
            state.numberVectors = true;
            const input = emitNumberArray(countSlice.form.source, lines);
            if (!input || typeof input.type === 'string') return undefined;
            const cells = input.cells ?? `${input.code}.cells`;
            lines.push(`vectorLive.push(${cells});`);
            const count = emit(countSlice.form.count, lines, 'integer');
            if (count?.type !== 'integer') return undefined;
            lines.push('vectorLive.pop();');
            state.syntax.add(countSlice.form.operator);
            const result = `countSlice${state.serial++}`, shape = `sliceShape${state.serial++}`;
            const bound = `sliceCount${state.serial++}`, skip = `sliceSkip${state.serial++}`, size = `sliceSize${state.serial++}`;
            const index = `sliceCell${state.serial++}`, width = `sliceWidth${state.serial++}`;
            lines.push(`const ${bound} = ${count.code}; if (${bound} < 0) throw overflow;
                const ${shape} = [...${input.code}.shape]; const ${width} = Math.min(${bound}, ${shape}[0]);
                const ${skip} = ${countSlice.form.operator === 'drop' ? `safe(${width} * ${shape}.slice(1).reduce((a,b) => safe(a*b), 1))` : '0'};
                ${shape}[0] = ${countSlice.form.operator === 'drop' ? `${shape}[0] - ${width}` : `${width}`};
                const ${size} = ${shape}.reduce((a,b) => safe(a*b), 1);
                const ${result} = vectorArray(${shape}, ${input.type.element === 'real'}, vectorPool, vectorLive, [result, iterationResult, ${cells}], ${input.type.element === 'boolean'});
                ${numberVectorLoop(size, index, [`${result}.store(${index}, ${cells}[${skip} + ${index}]);`])}`);
            return { code: result, cells: `${result}.cells`, type: input.type, fresh: true };
        }
        const indexedMask = numericIndices(source);
        if (indexedMask) {
            state.numberVectors = true;
            const mask = numberVector(indexedMask, lines);
            if (!mask || mask.type !== 'boolean') return undefined;
            const result = `positions${state.serial++}`, index = `cell${state.serial++}`;
            const count = `count${state.serial++}`, body: string[] = [];
            const selected = mask.cell(index, body);
            if (!selected) return undefined;
            builtins.set('indices', 'sequences');
            const position = `position${state.serial++}`;
            lines.push(`let ${count} = 0;
                ${numberVectorLoop(mask.size, index, [...body, `if (${selected.code}) ${count}++;`])}
                const ${result} = vectorArray([${count}], false, vectorPool, vectorLive, [result, iterationResult, ${mask.sources.join(',')}]); let ${position} = 0;
                ${numberVectorLoop(mask.size, index, [...body, `if (${selected.code}) ${result}.store(${position}++, ${index});`])}`);
            return { code: result, cells: `${result}.cells`, type: { kind: 'array', element: 'integer', rank: 1 }, fresh: true };
        }
        const primeBounds = numericPrimeCopy(source);
        if (primeBounds) {
            let lower: { code: string; inclusive: boolean } | undefined;
            let upper: { code: string; inclusive: boolean } | undefined;
            for (const bound of primeBounds) {
                const value = emit(bound.value, lines, 'integer');
                if (value?.type !== 'integer') return undefined;
                const code = `primeLimit${state.serial++}`;
                lines.push(`const ${code} = ${value.code};`);
                if (bound.upper) upper = { code, inclusive: bound.inclusive };
                else lower = { code, inclusive: bound.inclusive };
            }
            state.primeCopies = true;
            builtins.set('copy', 'sequences'); builtins.set('primes', 'sequences');
            const result = `primeArray${state.serial++}`;
            lines.push(`const ${result} = primeArray(${lower?.code ?? 'undefined'}, ${lower?.inclusive ?? false}, ${upper!.code}, ${upper!.inclusive});`);
            return { code: result, cells: `${result}.cells`, type: { kind: 'array', element: 'integer', rank: 1 }, fresh: true };
        }
        let copied = source;
        while (isParenthesizedExpression(copied)) copied = copied.value;
        if (host.nativeCalls && isApplicationExpression(copied) && copied.arguments.length === 1
            && isNameExpression(copied.arguments[0]) && copied.arguments[0].name === 'copy'
            && !localTypes.has('copy') && !arrays.has('copy') && !containers.has('copy')) {
            let range = copied.head;
            while (isParenthesizedExpression(range)) range = range.value;
            const selected = isApplicationExpression(range) ? flattenApplication(range) : [];
            // Native real gathers preserve uniform kind evidence through copy.
            // Private real publication would rescan every cell for infinities.
            if (selected.length === 2 && arrayType(selected[1]) && arrayType(range)?.element === 'real') return undefined;
            if (isBinaryExpression(range) || vectorOperation(range)
                || isApplicationExpression(range) && flattenApplication(range).length === 2
                || isTableFilterExpression(range)) {
                // These array expressions already allocate fresh private
                // storage. Names retain their ordinary snapshot-copy path.
                builtins.set('copy', 'sequences');
                const setup: string[] = [];
                const result = emitNumberArray(range, setup);
                if (!result) return undefined;
                lines.push(...setup);
                return result;
            }
        }
        let e = source;
        while (isParenthesizedExpression(e) || isMaterializeExpression(e)) e = isParenthesizedExpression(e) ? e.value : e.source;
        const type = arrayType(e);
        if (!type || type.element !== 'integer' && type.element !== 'real' && type.element !== 'boolean') return undefined;
        if (!state.numberVectors && type.rank > 1 && type.element === 'integer' && existingIntegerArrayArithmetic(e)) return undefined;
        if (isNameExpression(e)) {
            const info = arrays.get(e.name) ?? { slot: slot(e.name), rank: type.rank, type: type.element };
            arrays.set(e.name, info);
            if (!assigned.has(e.name)) arrayInputs.add(e.name);
            return { code: `r${info.slot}`, cells: `cells${info.slot}`, type };
        }
        const result = `vector${state.serial++}`;
        const selection = isApplicationExpression(e) ? flattenApplication(e) : [];
        const filter = isTableFilterExpression(e) && e.condition && !e.conditions.length && !e.sourceFields.length
            ? { source: e.source, mask: e.condition }
            : selection.length === 2 && arrayType(selection[0])
                && arrayType(selection[1])?.element === 'boolean' && arrayType(selection[1])?.rank === arrayType(selection[0])?.rank
                ? { source: selection[0], mask: selection[1] } : undefined;
        const scan = numericScan(e);
        const reshape = numericReshape(e);
        const reduction = axisReduction(e);
        if (reduction && reduction.form.operation.name === 'sum') {
            state.numberVectors = true;
            const input = numberVector(reduction.form.source, lines);
            if (!input || input.type !== 'integer') return undefined;
            builtins.set('sum', reduction.form.operation.module);
            const axes = new Set(resolveAxes(reduction.axes, input.rank, 'sum'));
            const shape = `shape${state.serial++}`, output = `shape${state.serial++}`;
            const index = `cell${state.serial++}`, target = `target${state.serial++}`;
            const strides = Array.from({ length: input.rank }, (_, axis) =>
                Array.from({ length: input.rank - axis - 1 }, (_, i) => `${shape}[${axis + i + 1}]`).join(' * ') || '1');
            let offset = '0';
            for (let axis = 0; axis < input.rank; axis++) if (!axes.has(axis)) {
                offset = `(${offset} * ${shape}[${axis}] + Math.floor(${index} / (${strides[axis]})) % ${shape}[${axis}])`;
            }
            const body: string[] = [];
            const value = input.cell(index, body);
            if (!value) return undefined;
            lines.push(`const ${shape} = ${input.shape};
                const ${output} = [${Array.from({ length: input.rank }, (_, axis) => axis).filter(axis => !axes.has(axis)).map(axis => `${shape}[${axis}]`).join(',')}];
                const ${result} = vectorArray(${output}, false, vectorPool, vectorLive, [result, iterationResult, ${input.sources.join(',')}]);
                ${result}.cells.fill(0);
                ${numberVectorLoop(input.size, index, [...body,
                    `const ${target} = ${offset};`,
                    `${result}.store(${target}, safe(Number(${result}.cells[${target}]) + ${value.code}));`,
                ])}`);
        } else if (scan) {
            state.numberVectors = true;
            const input = emitNumberArray(scan.form.source, lines);
            if (!input || typeof input.type === 'string') return undefined;
            const cells = input.cells ?? `${input.code}.cells`;
            lines.push(`vectorLive.push(${cells});`);
            const seed = scan.form.seed ? emit(scan.form.seed, lines, 'integer') : undefined;
            if (scan.form.seed && seed?.type !== 'integer') return undefined;
            const modulus = scan.modulus ? emit(scan.modulus, lines, 'integer') : undefined;
            if (scan.modulus && modulus?.type !== 'integer') return undefined;
            lines.push('vectorLive.pop();');
            state.syntax.add('scan');
            if (modulus) {
                const mod = `modulus${state.serial++}`, initial = `seed${state.serial++}`;
                // Reduced states fit Int32 and adding two residues stays exact.
                // Other moduli retain the exact native fold.
                lines.push(`const ${mod} = ${modulus.code}; if (${mod} <= 0 || ${mod} > 2147483648) throw overflow;
                    const ${initial} = ${seed ? `((${seed.code} % ${mod}) + ${mod}) % ${mod}` : '0'};`);
                const axis = scan.axis ?? 0;
                const shape = `shape${state.serial++}`, length = `length${state.serial++}`, inner = `inner${state.serial++}`;
                const output = `shape${state.serial++}`, index = `cell${state.serial++}`, value = `prefix${state.serial++}`;
                lines.push(`const ${shape} = ${input.code}.shape; const ${length} = ${shape}[${axis}];
                    const ${inner} = ${shape}.slice(${axis + 1}).reduce((a, b) => a * b, 1);
                    const ${output} = [...${shape}]; ${seed ? `${output}[${axis}]++;` : ''}
                    const ${result} = vectorArray(${output}, false, vectorPool, vectorLive, [result, iterationResult, ${cells}]);`);
                const position = `position${state.serial++}`;
                const source = seed ? `Math.floor(${index} / ((${length} + 1) * ${inner})) * ${length} * ${inner} + ${position} - ${inner}` : index;
                const body = (compact: boolean) => [
                    `const ${position} = ${axis === 0 ? index : `${index} % ((${length} + ${seed ? 1 : 0}) * ${inner})`};`,
                    `let ${value};`,
                    ...(seed ? [`if (${position} < ${inner}) ${value} = ${initial}; else {`] : []),
                    `let input = ${compact ? `${cells}[${source}]` : `safe(Number(${cells}[${source}]))`};`,
                    `if (input < 0 || input >= ${mod}) input = ((input % ${mod}) + ${mod}) % ${mod};`,
                    `${value} = ${!seed ? `${position} < ${inner} ? input : ` : ''}${scan.form.operator === '*'
                        ? `mulmod(Number(${result}.cells[${index} - ${inner}]), input, ${mod})`
                        : `Number(${result}.cells[${index} - ${inner}]) + input`};`,
                    ...(scan.form.operator === '+' ? [`if (${value} >= ${mod}) ${value} -= ${mod};`] : []),
                    ...(seed ? ['}'] : []),
                    `${result}.cells[${index}] = ${value};`,
                ];
                // Stored Int32 inputs already prove cell safety. Axis zero has
                // one outer block, so it needs no per-cell division/remainder.
                const checked = numberVectorLoop(`${result}.cells.length`, index, body(false));
                const compact = numberVectorLoop(`${result}.cells.length`, index, body(true));
                lines.push(`if (${cells} instanceof Int32Array) { ${compact} } else { ${checked} }`);
                return { code: result, cells: `${result}.cells`, type: scan.type, fresh: true };
            }
            const index = `cell${state.serial++}`, total = `prefix${state.serial++}`;
            const offset = seed ? 1 : 0;
            lines.push(`const ${result} = vectorArray([${cells}.length + ${offset}], false, vectorPool, vectorLive, [result, iterationResult, ${cells}]);
                let ${total} = ${seed?.code ?? '0'}; ${seed ? `${result}.store(0, ${total});` : ''}
                ${numberVectorLoop(`${cells}.length`, index, [
                    `${total} = safe(${total} + safe(Number(${cells}[${index}])));`,
                    `${result}.store(${index} + ${offset}, ${total});`,
                ])}`);
        } else if (reshape) {
            state.numberVectors = true;
            const input = emitNumberArray(reshape.form.source, lines);
            if (!input || typeof input.type === 'string') return undefined;
            lines.push(`vectorLive.push(${input.cells ?? `${input.code}.cells`});`);
            const dimensions: string[] = [];
            for (const part of reshape.form.dimensions) {
                if (isAllAxisExpression(part)) { dimensions.push('undefined'); continue; }
                const value = emit(part, lines, 'integer');
                if (value?.type !== 'integer') return undefined;
                const dimension = `dimension${state.serial++}`;
                lines.push(`const ${dimension} = ${value.code}; if (${dimension} < 0) throw overflow;`);
                dimensions.push(dimension);
            }
            lines.push('vectorLive.pop();');
            const shape = `shape${state.serial++}`, cells = input.cells ?? `${input.code}.cells`;
            builtins.set('reshape', 'sequences');
            const layout = `[${dimensions.join(',')}]`;
            lines.push(`const ${shape} = ${dimensions.includes('undefined') ? `inferShape(${layout}, ${cells}.length)` : layout};
                if (${shape}.reduce((a, b) => a * BigInt(b), 1n) !== BigInt(${cells}.length)) throw overflow;
                const ${result} = copyArray(${shape}, ${cells}, ${type.element === 'real'}, ${type.element === 'boolean'}, ${input.code});`);
        } else if (isBinaryExpression(e) && ['to', 'till'].includes(e.operator)) {
            state.numberVectors = true;
            const start = emit(e.left, lines, 'integer'), end = emit(e.right, lines, 'integer');
            const step = e.step ? emit(e.step, lines, 'integer') : undefined;
            if (!start || !end || e.step && !step) return undefined;
            lines.push(`const ${result} = rangeArray(${start.code}, ${end.code}, ${e.operator === 'to'}, ${step?.code ?? '1'}, vectorPool, vectorLive, [result, iterationResult], vectorStep);`);
            if (state.workCounting) lines.push(`work += ${result}.cells.length;`);
        } else if (filter) {
            state.numberVectors = true;
            const input = emitNumberArray(filter.source, lines);
            if (!input || typeof input.type === 'string') return undefined;
            const cells = input.cells ?? `${input.code}.cells`;
            lines.push(`vectorLive.push(${cells});`);
            const mask = numberVector(filter.mask, lines);
            if (!mask || mask.type !== 'boolean') return undefined;
            lines.push('vectorLive.pop();');
            const index = `cell${state.serial++}`, count = `count${state.serial++}`, body: string[] = [];
            const selected = mask.cell(index, body);
            if (!selected) return undefined;
            lines.push(`if (${input.code}.shape.length !== ${mask.shape}.length || ${input.code}.shape.some((size, axis) => size !== ${mask.shape}[axis])) throw overflow;
                if (${cells}.length !== ${mask.size}) throw overflow;
                const ${result} = vectorArray([${cells}.length], ${type.element === 'real'}, vectorPool, vectorLive, [result, iterationResult, ${[cells, ...mask.sources].join(',')}], ${type.element === 'boolean'}); let ${count} = 0;
                ${numberVectorLoop(`${cells}.length`, index, [...body, `if (${selected.code}) ${result}.store(${count}++, ${type.element === 'real' ? `Number(${cells}[${index}])` : `safe(Number(${cells}[${index}]))`});`])}
                ${result}.shape[0] = ${count}; ${result}.cells = ${result}.cells.subarray(0, ${count});`);
        } else if (isApplicationExpression(e) && flattenApplication(e).length === 2
            && arrayType(flattenApplication(e)[0])?.rank === 1
            && (arrayType(flattenApplication(e)[1])?.element === 'integer' || isRange(flattenApplication(e)[1]))) {
            // A rank-one source accepts an integer selector of any shape.
            // Complete the gather before binding it, retaining ordinary `=`
            // snapshots even when its source is written later in the region.
            const parts = flattenApplication(e);
            if (parts.length !== 2 || arrayType(parts[0])?.rank !== 1
                || arrayType(parts[1])?.element !== 'integer' && !isRange(parts[1])) return undefined;
            state.numberVectors = true;
            const source = emitNumberArray(parts[0], lines);
            if (!source || typeof source.type === 'string') return undefined;
            lines.push(`vectorLive.push(${source.cells ?? `${source.code}.cells`});`);
            if (vectorOperation(parts[1]) || sortedSearch(parts[1]) || isRange(parts[1])) {
                // A pure selector stage belongs to this gather's consumer.
                // The result still completes before its ordinary binding;
                // private failures replay the original operand boundaries.
                const selectors = numberVector(parts[1], lines, true);
                if (!selectors || selectors.type !== 'integer') return undefined;
                lines.push('vectorLive.pop();');
                const cells = source.cells ?? `${source.code}.cells`, index = `cell${state.serial++}`;
                const gather = (compact: boolean): string | undefined => {
                    const body: string[] = [];
                    const key = selectors.cell(index, body, { shape: selectors.shape, rank: selectors.rank,
                        compact, offsets: new Map(), values: new Map() });
                    if (!key) return undefined;
                    return numberVectorLoop(selectors.size, index, [...body,
                        `if (${key.code} < 0 || ${key.code} >= ${cells}.length) throw overflow;`,
                        compact ? `${result}.cells[${index}] = ${cells}[${key.code}];`
                            : `${result}.store(${index}, ${type.element === 'real' ? `Number(${cells}[${key.code}])` : `safe(Number(${cells}[${key.code}]))`});`,
                    ]);
                };
                const checked = gather(false), compact = gather(true);
                if (!checked || !compact) return undefined;
                lines.push(`const ${result} = vectorArray(${selectors.shape}, ${type.element === 'real'}, vectorPool, vectorLive,
                    [result, iterationResult, ${cells}, ${selectors.sources.join(',')}], ${type.element === 'boolean'});
                    if (${cells} instanceof Int32Array${selectors.compactGuards.map(guard => ` && (${guard})`).join('')}) { ${compact} }
                    else { ${checked} }`);
                return { code: result, cells: `${result}.cells`, type, fresh: true };
            }
            const selectors = emitNumberArray(parts[1], lines);
            if (!selectors || typeof selectors.type === 'string') return undefined;
            lines.push('vectorLive.pop();');
            const cells = source.cells ?? `${source.code}.cells`, keys = selectors.cells ?? `${selectors.code}.cells`;
            const index = `cell${state.serial++}`, key = `key${state.serial++}`;
            const gather = (compact: boolean) => numberVectorLoop(`${keys}.length`, index, [
                `const ${key} = ${compact ? `${keys}[${index}]` : `safe(Number(${keys}[${index}]))`};`,
                `if (${key} < 0 || ${key} >= ${cells}.length) throw overflow;`,
                compact ? `${result}.cells[${index}] = ${cells}[${key}];`
                    : `${result}.store(${index}, ${type.element === 'real' ? `Number(${cells}[${key}])` : `safe(Number(${cells}[${key}]))`});`,
            ]);
            // Int32 sources and selectors need only bounds checks. Every cell
            // fits either pooled output representation, without widening.
            lines.push(`const ${result} = vectorArray(${selectors.code}.shape, ${type.element === 'real'}, vectorPool, vectorLive, [result, iterationResult, ${cells}, ${keys}], ${type.element === 'boolean'});
                if (${cells} instanceof Int32Array && ${keys} instanceof Int32Array) { ${gather(true)} }
                else { ${gather(false)} }`);
        } else if (vectorOperation(e) || sortedSearch(e) || numericMembership(e)) {
            const input = numberVector(e, lines);
            if (!input) return undefined;
            const index = `cell${state.serial++}`, body: string[] = [];
            const value = input.cell(index, body);
            if (!value) return undefined;
            let loop = numberVectorLoop(input.size, index, [...body, type.element === 'boolean' ? `${result}.cells[${index}] = ${value.code} ? 1 : 0;`
                : type.element === 'real' ? `${result}.cells[${index}] = ${value.code};`
                    : `${result}.store(${index}, ${value.code});`]);
            if (type.element === 'integer' && input.sources.length) {
                const fast: string[] = [];
                const proven = input.cell(index, fast, { shape: input.shape, rank: input.rank,
                    compact: true, offsets: new Map(), values: new Map() });
                if (proven?.bounds) {
                    const direct = fitsIntegerRepresentation(proven.bounds, 'int32');
                    const store = direct ? `${result}.cells[${index}] = ${proven.code};` : `${result}.store(${index}, ${proven.code});`;
                    loop = `if (${input.compactGuards.join(' && ')}) {
                        ${numberVectorLoop(input.size, index, [...fast, store])}
                    } else { ${loop} }`;
                }
            }
            lines.push(`const ${result} = vectorArray(${input.shape}, ${type.element === 'real'}, vectorPool, vectorLive, [result, iterationResult, ${input.sources.join(',')}], ${type.element === 'boolean'}); ${loop}`);
        } else return undefined;
        return { code: result, cells: `${result}.cells`, type, fresh: true };
    }
    /** Consume array predicates without publishing a temporary mask. Later
     * cells may fail after any/all already has its answer: speculate privately
     * and replay on failure to retain the ordinary consumer's demand order. */
    function emitBooleanReduction(source: Expression, operation: 'any' | 'all', lines: string[]): LoopTerm | undefined {
        if (!numberMode || wide || !host.nativeCalls || !host.arrayReads || !host.booleanArrays
            || arrayType(source)?.element !== 'boolean' || !completedIndicesMask(source)) return undefined;
        let input = source;
        while (isParenthesizedExpression(input)) input = input.value;
        const mutable = isNameExpression(input) && state.arrayDefinitions.has(input.name) && destinations.has(input.name);
        // External completed bitmaps retain their cheaper population-count
        // reduction instead of scanning an unpacked vector on every iteration.
        if (!mutable && !privateIndicesMask(input)) return undefined;
        const setup: string[] = [], vector = numberVector(source, setup);
        if (!vector || vector.type !== 'boolean') return undefined;
        const result = `boolean${state.serial++}`, index = `cell${state.serial++}`, body: string[] = [];
        const value = vector.cell(index, body);
        if (!value) return undefined;
        const cell = `booleanCell${state.serial++}`;
        builtins.set(operation, 'sequences');
        lines.push(...setup, `let ${result} = ${operation === 'all'};`, numberVectorLoop(vector.size, index,
            [...body, `const ${cell} = ${value.code};`, `${result} = ${result} ${operation === 'all' ? '&&' : '||'} ${cell};`]));
        return { type: 'boolean', code: result };
    }
    /** Count private byte masks without publishing a packed array first.
     * Completed external masks retain their native word-wise popcount. */
    function emitBooleanCount(source: Expression, lines: string[]): LoopTerm | undefined {
        if (!numberMode || wide || !host.nativeCalls || !host.arrayReads || !host.booleanArrays) return undefined;
        let input = source;
        while (isParenthesizedExpression(input)) input = input.value;
        const type = arrayType(input);
        const mutable = isNameExpression(input) && state.arrayDefinitions.has(input.name) && destinations.has(input.name);
        if (type?.element !== 'boolean' || !completedIndicesMask(input) || !mutable && !privateIndicesMask(input)) return undefined;
        const setup: string[] = [];
        const vector = numberVector(input, setup);
        if (!vector || vector.type !== 'boolean') return undefined;
        const result = `count${state.serial++}`, index = `cell${state.serial++}`, body: string[] = [];
        const value = vector.cell(index, body);
        if (!value) return undefined;
        builtins.set('count', 'sequences');
        lines.push(...setup, `let ${result} = 0;`, numberVectorLoop(vector.size, index,
            [...body, `if (${value.code}) ${result}++;`]));
        return { type: 'integer', code: result, bounds: [0, 4294967295] };
    }
    /** Scalar inputs retain evaluation order. Number-vector divisions replay
     * the ordinary region on failure, preserving array error order; the exact
     * path only fuses total arithmetic. Entry guards exclude lazy inputs. */
    function emitIntegerSum(source: Expression, lines: string[]): LoopTerm | undefined {
        if (numberMode) {
            const type = arrayType(source);
            if (wide || !host.arrayReads || !type) return undefined;
            if (!state.numberVectors && type.rank > 1 && type.element === 'integer' && existingIntegerArrayArithmetic(source)) return undefined;
            const hasRange = (value: Expression): boolean => [value, ...AstUtils.streamAllContents(value)]
                .some(node => isBinaryExpression(node) && ['to', 'till'].includes(node.operator));
            // Reciprocal maps already require a linear consumer. Other inline
            // ranges keep native consumers and their analytic shortcuts.
            // A division only in a scalar bound must not disable that shortcut.
            const inlineRange = hasRange(source);
            if (inlineRange) {
                if (![source, ...AstUtils.streamAllContents(source)].some(node =>
                    isBinaryExpression(node) && node.operator === '//' && hasRange(node.right))) return undefined;
                // Sequence/sequence operations zip to the shorter input;
                // sequence/array operations are not scalar broadcasting.
                // Only a single progression with scalar maps enters here.
                const singleRangeMap = (value: Expression): boolean => {
                    while (isParenthesizedExpression(value)) value = value.value;
                    if (isBinaryExpression(value) && ['to', 'till'].includes(value.operator)) {
                        return [value.left, value.right, ...(value.step ? [value.step] : [])]
                            .every(bound => !arrayType(bound));
                    }
                    const point = vectorOperation(value);
                    if (!point) return false;
                    const ranges = point.operands.filter(hasRange);
                    return ranges.length === 1 && singleRangeMap(ranges[0])
                        && point.operands.filter(operand => !hasRange(operand)).every(operand => !arrayType(operand));
                };
                if (!singleRangeMap(source)) return undefined;
            }
            const setup: string[] = [];
            const vector = numberVector(source, setup, inlineRange);
            if (!vector || vector.type !== 'integer' && vector.type !== 'real') return undefined;
            const result = `sum${state.serial++}`, index = `cell${state.serial++}`, body: string[] = [];
            const value = vector.cell(index, body);
            if (!value) return undefined;
            builtins.set('sum', 'core');
            // An empty real sum has the integer identity 0 in the evaluator.
            // Replay rather than publish it with an incorrect scalar type.
            if (vector.type === 'real') setup.push(`if (${vector.size} === 0) throw overflow;`);
            lines.push(...setup, `let ${result} = 0;`, numberVectorLoop(vector.size, index, [...body, `${result} = ${vector.type === 'integer' ? safe(`${result} + ${value.code}`) : `${result} + ${value.code}`};`]));
            return { type: vector.type, code: result };
        }
        type Vector = { size: string; scalar?: true; cell(index: string, body: string[]): LoopTerm };
        function scalarSyntax(e: Expression): boolean {
            if (isParenthesizedExpression(e)) return scalarSyntax(e.value);
            return isNameExpression(e) || isNumberLiteral(e)
                || isUnaryExpression(e) && scalarSyntax(e.operand)
                || isBinaryExpression(e) && !e.step && scalarSyntax(e.left) && scalarSyntax(e.right);
        }
        let numericExpressions: LoopExpressions | undefined;
        const numericScalars: string[] = [];
        const exactScalars = new Map<Expression, LoopTerm>();
        function vector(e: Expression, numeric = false, setup = lines): Vector | undefined {
            while (isParenthesizedExpression(e)) e = e.value;
            const type = arrayType(e);
            if (!type) {
                if (!scalarSyntax(e)) return undefined;
                const scalar = numeric ? exactScalars.get(e) : emit(e, setup, 'integer');
                if (scalar?.type !== 'integer') return undefined;
                if (!numeric) {
                    exactScalars.set(e, scalar);
                    return { size: '1', scalar: true, cell: () => scalar };
                }
                const value = `scalar${state.serial++}`;
                setup.push(`const ${value} = Number(${scalar.code});`);
                numericScalars.push(value);
                return { size: '1', scalar: true, cell: () => ({ type: 'integer', code: value }) };
            }
            if (type.rank !== 1 || type.element !== 'integer') return undefined;
            if (isNameExpression(e)) {
                const info = arrays.get(e.name) ?? { slot: slot(e.name), rank: 1, type: 'integer' as const };
                arrays.set(e.name, info);
                if (!assigned.has(e.name)) arrayInputs.add(e.name);
                const size = `length${state.serial++}`;
                setup.push(`const ${size} = ${state.numberMode ? `cells${info.slot}.length` : `r${info.slot}.shape[0]`};`);
                return { size, cell: index => ({ type: 'integer', code: state.numberMode
                    ? !numeric && wide ? `BigInt(cells${info.slot}[${index}])` : `safe(Number(cells${info.slot}[${index}]))`
                    : `reader${info.slot}(BigInt(${index}))` }) };
            }
            if (!isBinaryExpression(e) || e.step || !(wide && state.numberMode ? ['+', '-', '*', '//', 'mod'] : ['+', '-', '*']).includes(e.operator)) return undefined;
            const left = vector(e.left, numeric, setup), right = vector(e.right, numeric, setup);
            if (!left || !right) return undefined;
            const size = `length${state.serial++}`;
            // A singleton array operand may fail before an empty broadcast
            // consumes it. Scalar inputs were already captured above.
            if (wide && !left.scalar && !right.scalar) setup.push(
                `if (${left.size} !== ${right.size} && (${left.size} === 0 || ${right.size} === 0)) throw overflow;`);
            setup.push(`if (${left.size} !== ${right.size} && ${left.size} !== 1 && ${right.size} !== 1) throw ${wide && state.numberMode ? 'overflow' : `shapeMismatch(${left.size}, ${right.size})`};`,
                `const ${size} = ${left.size} === 1 ? ${right.size} : ${left.size};`);
            return { size, cell: (index, body) => {
                const a = left.cell(`(${left.size} === 1 ? 0 : ${index})`, body);
                const b = right.cell(`(${right.size} === 1 ? 0 : ${index})`, body);
                return { type: 'integer', code: (numeric ? numericExpressions! : { arithmetic }).arithmetic(e.operator, a, b, 'integer', body)! };
            } };
        }
        if (wide && !state.numberMode || !host.arrayReads || !arrayType(source)) return undefined;
        // Exact vector errors replay the region: a fused cell must not change
        // which completed operand fails first, even on an empty domain.
        if (wide) vectorCellDepth++;
        let input: ReturnType<typeof vector>;
        try { input = vector(source); }
        finally { if (wide) vectorCellDepth--; }
        if (!input) return undefined;
        const result = `sum${state.serial++}`, index = `cell${state.serial++}`, body: string[] = [];
        if (wide) vectorCellDepth++;
        let value: LoopTerm;
        try { value = input.cell(index, body); }
        finally { if (wide) vectorCellDepth--; }
        builtins.set('sum', 'core');
        if (wide) {
            // Pure checked arithmetic may stay numeric until one cell
            // overflows. Retry just that cell exactly; domain errors retain
            // their ordinary failure. Keep completed numeric subtotals.
            const numeric = [source, ...AstUtils.streamAllContents(source)].every(node =>
                !isBinaryExpression(node) || ['+', '-', '*', '//'].includes(node.operator));
            const setup: string[] = [];
            numericExpressions = numeric ? createLoopExpressions(state) : undefined;
            const fast = numeric ? vector(source, true, setup) : undefined;
            const fastBody: string[] = [], term = fast?.cell(index, fastBody);
            if (fast && term) {
                const subtotal = `partial${state.serial++}`, exact = `exact${state.serial++}`;
                // Unsafe captured scalars keep this region and its numeric
                // arrays; their reduction simply stays exact throughout.
                const eligible = numericScalars.length ? numericScalars.map(value => `Number.isSafeInteger(${value})`).join(' && ') : undefined;
                lines.push(...setup, `let ${result} = 0n, ${subtotal} = 0, ${exact} = 0;`,
                    ...(eligible ? [`if (${eligible}) {`] : []),
                    numberVectorLoop(input.size, index, [`try {
                        ${fastBody.join('\n')}
                        const term = ${term.code}, next = ${subtotal} + term;
                        if (Number.isSafeInteger(next)) ${subtotal} = next;
                        else { ${result} += BigInt(${subtotal}) + BigInt(term); ${subtotal} = 0; }
                    } catch (error) {
                        if (error !== overflow) throw error;
                        ${body.join('\n')}
                        ${result} += BigInt(${subtotal}) + ${value.code}; ${subtotal} = 0; ${exact}++;
                    }`]), `${result} += BigInt(${subtotal}); recordWideFold(${input.size}, ${exact});`,
                    ...(eligible ? ['} else {', numberVectorLoop(input.size, index,
                        [...body, `${result} += ${value.code};`]), `recordWideFold(${input.size}, ${input.size}); }`] : []));
            } else lines.push(`let ${result} = 0n;`, numberVectorLoop(input.size, index,
                [...body, `${result} += ${value.code};`]));
            if (!temporaryBudget(source)) return undefined;
            return { code: result, type: 'integer' };
        }
        lines.push(`let ${result} = ${numberMode ? '0' : '0n'}; for (let ${index} = 0; ${index} < ${input.size}; ${index}++) {
            checkpoint(); ${body.join('\n')} ${result} = ${safe(`${result} + ${value.code}`)};
        }`);
        if (!temporaryBudget(source)) return undefined;
        return { code: result, type: 'integer' };
    }
    function emitValue(e: Expression, lines: string[], hint?: LoopTerm['type'], tail = false): LoopValue | undefined {
        let source = e;
        while (isParenthesizedExpression(source)) source = source.value;
        const concat = numericConcatCopy(source);
        if (concat) {
            const operands: string[] = [];
            for (const operand of concat.operands) {
                const value = emitArrayValue(operand, lines);
                if (!value) return undefined;
                const info = arrays.get(operand.name)!;
                operands.push(`cells${info.slot}`);
            }
            builtins.set('copy', 'sequences');
            const result = `concatenated${state.serial++}`;
            lines.push(`const ${result} = concatArrays([${operands.join(',')}], ${concat.type.element === 'real'});`);
            return { code: result, type: concat.type };
        }
        if (numberMode && host.arrayLocals && host.arrayReads && host.nativeCalls
            && isApplicationExpression(source) && source.arguments.length === 1
            && isNameExpression(source.head) && isNameExpression(source.arguments[0])
            && source.arguments[0].name === 'copy' && !localTypes.has('copy') && !arrays.has('copy') && !containers.has('copy')) {
            const name = source.head.name, type = arrayType(source.head);
            if (type?.element === 'integer') {
                const info = arrays.get(name) ?? { slot: slot(name), rank: type.rank, type: 'integer' as const };
                arrays.set(name, info);
                if (!assigned.has(name)) arrayInputs.add(name);
                builtins.set('copy', 'sequences');
                const result = `copied${state.serial++}`;
                lines.push(`const ${result} = copyArray(r${info.slot}.shape, cells${info.slot});`);
                return { code: result, type };
            }
        }
        if (!state.numberMode && host.arrayLocals && host.arrayReads) {
            if (isArrayExpression(source) && !source.dimensions.length && !source.range && !source.fill && !source.rows.length && source.items.length) {
                const cells: string[] = [];
                let type: CompiledArrayType['element'] | undefined;
                for (const item of source.items) {
                    const value = emit(item.value, lines);
                    if (!value || value.type === 'bytes' || type && type !== value.type
                        || item.sign && !['integer', 'real'].includes(value.type)) return undefined;
                    type = value.type;
                    const cell = `cell${state.serial++}`;
                    lines.push(`const ${cell} = ${item.sign === '-' ? `-(${value.code})` : value.code};`);
                    cells.push(cell);
                }
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ownedArray([${cells.join(',')}], [${cells.length}], true);`);
                return { code: name, type: { kind: 'array', element: type!, rank: 1 } };
            }
            if (isApplicationExpression(source) && source.arguments.length === 1
                && isNameExpression(source.head) && isNameExpression(source.arguments[0]) && source.arguments[0].name === 'pop') {
                const name = source.head.name, current = host.read(name);
                const first = current && hasNativeDeque(current) && current.size ? current.at(0) : undefined;
                const type = first && compiledArgumentType(first);
                if (type && typeof type !== 'string' && type.kind === 'array' && type.element === 'integer') {
                    const receiver = container(name, 'deque');
                    const info = containers.get(name);
                    if (!receiver || !info || info.integers || info.array && (info.array.rank !== type.rank || info.array.type !== type.element)) return undefined;
                    info.array = { rank: type.rank, type: type.element };
                    builtins.set('pop', 'algo');
                    const result = `v${state.serial++}`;
                    lines.push(`const ${result} = ${receiver}.pop();`);
                    return { code: result, type, deque: true };
                }
            }
        }
        if (!state.numberMode && host.arrayLocals && host.arrayReads) {
            let selection = source, copied = false, selectedArguments = 0;
            const view = state.sliceView;
            state.sliceView = false;
            if (isApplicationExpression(selection)) {
                const parts = flattenApplication(selection), last = parts.at(-1);
                if (last && isNameExpression(last) && last.name === 'copy' && host.nativeCalls
                    && !localTypes.has('copy') && !arrays.has('copy') && !containers.has('copy')) {
                    copied = true;
                    selectedArguments = parts.length - 1;
                    selection = applicationExpression(parts.slice(0, -1), selection);
                    while (isParenthesizedExpression(selection)) selection = selection.value;
                }
            }
            const range = rangeSliceOperands(selection);
            if (range && isNameExpression(range.source) && !range.source.name.includes('.')
                && !localTypes.has(range.source.name)) {
                const name = range.source.name, previous = arrays.get(name);
                const current = previous ? undefined : host.read(name);
                const kinds = current && isRankArray(current) ? storedScalarKinds(current) : undefined;
                const type = previous?.type ?? (kinds?.length === 1 ? kinds[0] : undefined);
                const rank = previous?.rank ?? (current && isRankArray(current) ? current.shape.length : undefined);
                if (rank !== undefined && range.axis < BigInt(rank) && (type === 'integer'
                    || type === 'real' && host.reals || type === 'boolean' && host.booleanArrays
                    || type === 'text' && host.textArrayLoops)) {
                    const start = emit(range.start, lines, 'integer'), end = emit(range.end, lines, 'integer');
                    if (start?.type !== 'integer' || end?.type !== 'integer') return undefined;
                    const info = previous ?? { slot: slot(name), rank, type };
                    arrays.set(name, info);
                    if (!assigned.has(name)) arrayInputs.add(name);
                    if (copied) builtins.set('copy', 'sequences');
                    // A region writes directly into owned storage. Complete the
                    // selection now so later stores cannot change its snapshot.
                    const result = `v${state.serial++}`;
                    if (view && !copied) state.viewResult = result;
                    const call = `copySlice(r${info.slot}, ${start.code}, ${end.code}, ${range.axis}, ${range.inclusive}${view && !copied ? ', true' : ''})`;
                    lines.push(selectedArguments > 1
                        ? `let ${result}; try { ${result} = ${call}; } catch (error) { throw argumentSelectionError(error, 'copy', ${selectedArguments}); }`
                        : `const ${result} = ${call};`);
                    return { code: result, type: { kind: 'array', element: type, rank } };
                }
            }
        }
        if (numberMode && host.arrayLocals && host.arrayReads && arrayType(source)) {
            const setup: string[] = [];
            const value = emitNumberArray(source, setup);
            if (value) {
                lines.push(...setup);
                return value;
            }
        }
        if (!state.numberMode && host.arrayLocals && host.arrayReads && host.arrayValues && arrayType(source)) {
            return emitArrayValue(source, lines);
        }
        if (isApplicationExpression(source) || isDeclaredCallExpression(source)) {
            // Whole-value stores/returns may accept an array call. Other forms
            // keep the shared scalar inference, including min/max grouping.
            const parts = isDeclaredCallExpression(source) ? positionalDeclaredCall(source) : flattenApplication(source);
            const last = parts?.at(-1);
            if (last && isNameExpression(last) && host.scalarFunction(last.name, parts!.length - 1)) {
                return emitInput(source, lines, hint, tail);
            }
        }
        return emit(e, lines, hint, tail);
    }
    function emitInput(e: Expression, lines: string[], hint?: LoopTerm['type'], tail = false): LoopValue | undefined {
        if (isNameExpression(e) && state.ranges.has(e.name)) return reject(e, 'range-consumer');
        if (!temporaryBudget(e)) return undefined;
        if (numberMode && !wide && isFirstIndexWhereExpression(e)) {
            const setup: string[] = [];
            const source = emitNumberArray(e.source, setup);
            if (!source || typeof source.type === 'string' || source.type.rank !== 1) return undefined;
            // Subject comparisons are pure pointwise expressions. Other masks
            // retain their own source and are validated before the first read.
            const condition = isSubjectComparisonExpression(e.mask) ? {
                $type: 'BinaryExpression', operator: e.mask.operator,
                left: e.mask.stepOperator && e.mask.stepOperand ? {
                    $type: 'BinaryExpression', operator: e.mask.stepOperator,
                    left: e.source, right: e.mask.stepOperand,
                } : e.source, right: e.mask.right,
            } as Expression : e.mask;
            const mask = numberVector(condition, setup);
            if (!mask || mask.type !== 'boolean' || mask.rank !== 1) return undefined;
            const found = `found${state.serial++}`, index = `cell${state.serial++}`, label = `search${state.serial++}`;
            const body: string[] = [], value = mask.cell(index, body);
            if (!value) return undefined;
            lines.push(...setup, `if (${source.code}.shape[0] !== ${mask.size}) throw overflow; let ${found} = -1;`,
                numberVectorLoop(mask.size, index, [...body, `if (${value.code}) { ${found} = ${index}; break ${label}; }`], label),
                `if (${found} < 0) throw overflow;`);
            return { type: 'integer', code: found };
        }
        const supplied = scalarInputs.get(e);
        if (supplied) return supplied;
        const choice = host.nativeCalls && scalarChooseOperands(e,
            name => !localTypes.has(name) && !arrays.has(name) && !containers.has(name));
        if (choice) {
            const callStart = calls.length, calloutStart = state.callouts.length;
            const values: LoopTerm[] = [];
            for (const [index, operand] of choice.entries()) {
                const value = emit(operand, lines, index === 0 ? 'boolean' : undefined);
                if (!value || index === 0 && value.type !== 'boolean'
                    || index === 2 && value.type !== values[1].type) return undefined;
                // Native choose evaluates every operand before selection.
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${value.code};`);
                values.push({ ...value, code: name });
            }
            // A callback could replace choose while its operands evaluate.
            if (state.callouts.length !== calloutStart || calls.slice(callStart).some(call => !call.privateStateSafe)) return undefined;
            builtins.set('choose', 'core');
            const result = `v${state.serial++}`;
            lines.push(`const ${result} = ${values[0].code} ? ${values[1].code} : ${values[2].code};`);
            return { code: result, type: values[1].type };
        }
        if (numberMode && !wide && host.nativeCalls && host.arrayReads && host.module('algo') && isApplicationExpression(e)) {
            const parts = flattenApplication(e);
            const op = parts[2];
            if (parts.length === 3 && isNameExpression(parts[0]) && isNameExpression(op)
                && ['lowerindex', 'upperindex'].includes(op.name)
                && !localTypes.has(op.name) && !arrays.has(op.name) && !containers.has(op.name)) {
                const type = arrayType(parts[0]);
                if (type?.rank === 1 && (type.element === 'integer' || type.element === 'real' && host.reals)) {
                    const source = emitArrayValue(parts[0], lines), target = emit(parts[1], lines);
                    if (!source || target?.type !== 'integer' && target?.type !== 'real') return undefined;
                    const info = arrays.get(parts[0].name)!;
                    const result = `searchIndex${state.serial++}`;
                    builtins.set(op.name, 'algo');
                    // One native-size search over already guarded numeric cells.
                    // Observable search checkpoints retain the publishing path.
                    if (state.workCounting) lines.push(`work += Math.ceil(Math.log2(cells${info.slot}.length + 1));`);
                    lines.push(`const ${result} = sortedIndex(cells${info.slot}, ${target.code}, ${op.name === 'upperindex'});`);
                    return { code: result, type: 'integer' };
                }
            }
        }
        if (isNameExpression(e) && !e.name.includes('.')) {
            if (arrays.has(e.name)) return undefined;
            const type = localTypes.get(e.name) ?? (textSources.has(e.name) ? 'text' : hint ?? realInput(e.name) ?? 'integer');
            if (hint && type !== hint || type === 'boolean' && !host.booleanLocals) return undefined;
            localTypes.set(e.name, type);
            const index = slot(e.name);
            if (!assigned.has(e.name)) required.add(index);
            const bounds = numberMode && type === 'integer' ? safeIntegerRange(state.integerRanges.values.get(e)) : undefined;
            if (numberMode && state.wideScalars.has(e.name)) {
                if (!bounds) return undefined;
                state.rangeNarrowing = true;
            }
            const code = wide && type === 'integer' && !state.wideScalars.has(e.name) ? `BigInt(r${index})`
                : numberMode && state.wideScalars.has(e.name) ? `Number(r${index})` : `r${index}`;
            return { code, type, bounds };
        }
        if (isApplicationExpression(e) && e.arguments.length === 1 && isNameExpression(e.arguments[0])) {
            const op = e.arguments[0].name;
            if ((op === 'any' || op === 'all') && !localTypes.has(op) && !arrays.has(op) && !containers.has(op)) {
                const result = emitBooleanReduction(e.head, op, lines);
                if (result) return result;
            }
            if (op === 'count' && !localTypes.has(op) && !arrays.has(op) && !containers.has(op)) {
                const result = emitBooleanCount(e.head, lines);
                if (result) return result;
            }
            if (op === 'sum' && !localTypes.has(op) && !arrays.has(op) && !containers.has(op)) {
                const result = emitIntegerSum(e.head, lines);
                if (result) return result;
            }
            if (!numberMode && op === 'text' && host.scalarText) {
                const value = emit(e.head, lines);
                if (value?.type !== 'integer') return undefined;
                builtins.set(op, 'core');
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = (${value.code}).toString();`);
                // Decimal integer rendering has one UTF-16 unit per code point.
                return { code: name, type: 'text', ascii: true };
            }
            if (op === 'len') {
                let array = isNameExpression(e.head) ? arrays.get(e.head.name) : undefined;
                // A range header is lowered before its body. Discover an input
                // array here even when its first indexed read comes later.
                if (!array && host.arrayReads && isNameExpression(e.head) && !e.head.name.includes('.')
                    && !localTypes.has(e.head.name) && !containers.has(e.head.name)) {
                    const value = host.read(e.head.name);
                    const kinds = value && isRankArray(value) ? storedScalarKinds(value) : undefined;
                    const type = kinds?.length === 0 ? 'integer' : kinds?.length === 1 ? kinds[0] : undefined;
                    if (value && isRankArray(value) && (type === 'integer' || type === 'real' && host.reals
                        || type === 'text' && host.textArrayLoops || type === 'boolean' && host.booleanArrays)) {
                        array = { slot: slot(e.head.name), rank: value.shape.length, type };
                        arrays.set(e.head.name, array);
                    }
                }
                if (array && isNameExpression(e.head)) {
                    if (!assigned.has(e.head.name)) arrayInputs.add(e.head.name);
                    builtins.set(op, 'core');
                    const length = `r${array.slot}.shape[0] ?? 0`;
                    return { code: numberMode ? safe(length) : `BigInt(${length})`, type: 'integer' };
                }
            }
            if (op === 'len' && host.scalarText) {
                if (!numberMode && host.nativeCalls && knownType(e.head) === 'bytes') {
                    const value = emit(e.head, lines, 'bytes');
                    if (!value) return undefined;
                    builtins.set(op, 'core');
                    return { code: `BigInt(${value.code}.shape[0])`, type: 'integer' };
                }
                const knownText = isStringLiteral(e.head) || isApplicationExpression(e.head)
                    || isParenthesizedExpression(e.head)
                    || isNameExpression(e.head) && (localTypes.get(e.head.name) === 'text' || textSources.has(e.head.name));
                if (knownText) {
                    const value = emit(e.head, lines);
                    if (value?.type !== 'text') return undefined;
                    builtins.set(op, 'core');
                    const name = `v${state.serial++}`;
                    const length = value.ascii ? `(${value.code}).length` : `textLength(${value.code})`;
                    lines.push(`const ${name} = ${numberMode ? safe(length) : `BigInt(${length})`};`);
                    return { code: name, type: 'integer' };
                }
            }
            const builtin = inlineBuiltins.get(op);
            if (builtin && (host.module(builtin.module) || !host.scalarFunction(op, 1))
                && (builtin.enabled?.(host) ?? true)
                && (flattenApplication(e).length === 2 || unaryApplicationHead(e,
                    name => findOperation(name)?.arities) === e.head)) {
                // Mixed regions need an exact helper for BigInt operands.
                if (wide && !builtin.exactCode) return undefined;
                const value = emit(e.head, lines);
                const type = value && builtin.types[value.type];
                if (!value || !type) return undefined;
                builtins.set(op, builtin.module);
                const test = builtin.domain?.test(value.code, value.type);
                if (test) lines.push(`if (${test}) throw domain(${JSON.stringify(builtin.domain!.message)});`);
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${wide ? builtin.exactCode!(value.code) : builtin.code(value.code, value.type, numberMode)};`);
                return { code: name, type };
            }
            if (!numberMode && (op === 'len' || op === 'pop') && isNameExpression(e.head)) {
                const receiver = container(e.head.name, 'deque', op === 'pop');
                if (!receiver) return undefined;
                builtins.set(op, op === 'len' ? 'core' : 'algo');
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${op === 'len' ? `BigInt(${receiver}.size)` : `${receiver}.pop()`};`);
                return { code: name, type: 'integer' };
            }
        }
        if (isApplicationExpression(e) || isDeclaredCallExpression(e)) {
            const declared = isDeclaredCallExpression(e);
            const parts = declared ? positionalDeclaredCall(e) : flattenApplication(e);
            if (!parts) return undefined;
            const last = parts.at(-1);
            if (last && isNameExpression(last) && !last.name.includes('.')) {
                const operation = !declared && host.nativeCalls ? findOperation(last.name) : undefined;
                const signatures = operation ? compiledCallSignatures(operation) : [];
                const signature = signatures.length === 1 ? signatures[0]
                    : operation && matchCompiledCallSignature(operation, parts.slice(0, -1).map(part => knownType(part) ?? 'unknown'));
                const prepareCallee = host.scalarFunction(last.name, parts.length - 1, declared, immediateConsumer(e));
                // Prefer a known user function while its namesake module is unopened.
                // An unresolved name can still bind the builtin after a later import.
                if (operation && signature && signature.inputs.length === parts.length - 1
                    && (host.module(operation.module) || !prepareCallee)) {
                    return emitBuiltinCall(operation, signature, parts.slice(0, -1), lines);
                }
                if (prepareCallee) {
                    const arguments_: string[] = [];
                    const types: CompiledCalleeType[] = [];
                    const realShapes = new Map<number, string>();
                    for (let part of parts.slice(0, -1)) {
                        while (isParenthesizedExpression(part)) part = part.value;
                        const existing = isNameExpression(part) && !scalarInputs.has(part) ? arrays.get(part.name) : undefined;
                        const current = isNameExpression(part) && !scalarInputs.has(part) && !localTypes.has(part.name) ? host.read(part.name) : undefined;
                        if (current && isNameExpression(part) && (current instanceof RankDeque
                            || isRankIndex(current) && current.entries instanceof ResourceMap
                            || hasNativeIntegerGroups(current)
                            || isRankSet(current) && current.entries instanceof IntegerEntries && current.entries.integers)) {
                            if (numberMode) return undefined;
                            const kind = current instanceof RankDeque ? 'deque' : hasNativeIntegerGroups(current) ? 'groups' : isRankSet(current) ? 'set' : 'index';
                            const receiver = container(part.name, kind);
                            if (!receiver) return undefined;
                            containers.get(part.name)!.integers = true;
                            arguments_.push(receiver);
                            if (current instanceof RankDeque) {
                                containers.get(part.name)!.mode = current.mode;
                                types.push({ kind: 'deque', mode: current.mode });
                            } else types.push({ kind: kind === 'groups' ? 'groups' : isRankSet(current) ? 'set' : 'index' });
                            continue;
                        }
                        const type = existing ? { kind: 'array' as const, element: existing.type, rank: existing.rank }
                            : current === undefined ? undefined : compiledStoredArgumentType(current);
                        if (type && typeof type !== 'string' && isNameExpression(part)) {
                            if (!host.arrayReads || numberMode && (type.element === 'integer' ? type.rank !== 1 : type.element !== 'real' || type.rank > 2)
                                || type.element === 'real' && (!numberMode || !host.reals) || type.element === 'bytes'
                                || type.element === 'text' && !host.textArrayLoops
                                || type.element === 'boolean' && !host.booleanArrays) return undefined;
                            const info = existing ?? { slot: slot(part.name), rank: type.rank, type: type.element };
                            arrays.set(part.name, info);
                            calleeArrays.add(part.name);
                            if (!assigned.has(part.name)) arrayInputs.add(part.name);
                            // Pass the current buffer, including any private stores
                            // or widening before this call. The callee proof below
                            // excludes writes, escaping arrays and opaque callbacks.
                            if (numberMode && type.element === 'real') realShapes.set(arguments_.length, `r${info.slot}.shape`);
                            arguments_.push(numberMode ? `cells${info.slot}` : `r${info.slot}`);
                            types.push({ kind: 'array', element: type.element, rank: type.rank });
                        } else {
                            const value = emit(part, lines, knownType(part));
                            if (!value || value.type === 'bytes' || value.type === 'real' && !host.reals) return undefined;
                            arguments_.push(value.code);
                            types.push(value.type);
                        }
                    }
                    const callable = prepareCallee(types);
                    const exactCall = wide && state.numberMode;
                    if (exactCall && (!callable?.effects.privateStateSafe
                        || types.some(type => typeof type !== 'string')
                        || callable.locals.some(name => destinations.has(name) || arrays.has(name)))) return undefined;
                    if (callable?.type === 'real' && !host.reals) return reject(e, 'unsupported-type:real');
                    if (numberMode && (!callable?.numberSafe || !callable.bindNumber || callable.locals.some(name => destinations.has(name) || arrays.has(name)))) return undefined;
                    if (callable) {
                        if (typeof callable.type !== 'string') {
                            if (numberMode && !callable.numberArrayResult || !host.arrayLocals || callable.type.element === 'real' && (!numberMode || !host.reals)
                                || callable.type.element === 'boolean' && !host.booleanArrays
                                || callable.type.element === 'text' && !host.textArrayLoops) return undefined;
                            if (!numberMode) state.hasArrayCall = true;
                        }
                        const name = `v${state.serial++}`, index = calls.length;
                        // The proof fixes input domains and permitted mutations.
                        // Binding identity is rechecked at every region entry.
                        if (numberMode) {
                            calls.push({
                                name: last.name,
                                locals: callable.locals,
                                stableArrayReads: callable.effects.stableArrayReads,
                                privateStateSafe: callable.effects.privateStateSafe,
                                numberSafe: true,
                                numberArrayResult: callable.numberArrayResult,
                                exactOutput: callable.effects.localWrites && callable.effects.privateStateSafe
                                    && types.every(type => typeof type === 'string') ? e : undefined,
                                bind: work => callable.bindNumber!(work),
                            });
                            if (callable.numberArrayPool) state.numberVectors = true;
                            const allocation = callable.numberArrayPool
                                ? `(shape => vectorArray(shape, true, vectorPool, vectorLive, [result, iterationResult, ${arguments_.join(',')}]))` : undefined;
                            const inputs = callable.numberArrayPool ? arguments_.map((argument, i) => realShapes.has(i)
                                ? `{cells:${argument},shape:${realShapes.get(i)}}` : argument) : arguments_;
                            const callCode = `call${index}(${[...inputs, ...(allocation ? [allocation] : [])].join(',')})`;
                            lines.push(`const ${name} = ${callable.type === 'integer' ? safe(callCode) : callCode};`);
                        } else {
                            calls.push({
                                name: last.name,
                                locals: callable.locals,
                                stableArrayReads: callable.effects.stableArrayReads,
                                privateStateSafe: callable.effects.privateStateSafe,
                                numberSafe: exactCall,
                                bind: callable.bind,
                            });
                            lines.push(tail
                                ? `const ${name} = calls[${index}]([${arguments_.join(',')}], tailCallsAllowed);`
                                : `const ${name} = calls[${index}](${arguments_.join(',')});`);
                        }
                        return { code: name, type: callable.type };
                    }
                }
            }
        }
        if (isApplicationExpression(e)) {
            if (!host.arrayReads) return undefined;
            const [head, ...arguments_] = flattenApplication(e);
            if (!isNameExpression(head) || head.name.includes('.')) return undefined;
            const current = !localTypes.has(head.name) && !arrays.has(head.name) ? host.read(head.name) : undefined;
            if (hasNativeFenwick(current)) {
                const prefix = arguments_.length === 2 && isNameExpression(arguments_[0]) && arguments_[0].name === 'sum';
                if (hint && hint !== 'integer' || arguments_.length !== (prefix ? 2 : 1)) return undefined;
                const receiver = container(head.name, 'fenwick');
                const index = emit(arguments_[prefix ? 1 : 0], lines, 'integer');
                if (!receiver || index?.type !== 'integer') return undefined;
                if (prefix) builtins.set('sum', 'core');
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${receiver}.${prefix ? 'sum' : 'at'}(${index.code});`);
                return {code:name,type:'integer'};
            }
            if (current && isRankIndex(current) && current.entries instanceof IndexEntries) {
                if (hint && hint !== 'integer' || !arguments_.length) return undefined;
                const receiver = container(head.name, 'index', true);
                if (!receiver) return undefined;
                const keys: string[] = [];
                for (const argument of arguments_) {
                    const key = emit(argument, lines, 'integer');
                    if (key?.type !== 'integer') return undefined;
                    keys.push(key.code);
                }
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${state.numberMode ? `${receiver}.${wide ? 'readWide' : 'read'}(key([${keys.join(',')}]))` : `indexRead(${receiver}, key([${keys.join(',')}]))`};`);
                return { code: name, type: 'integer', selection: true };
            }
            if (!numberMode && host.nativeCalls && host.textLoops && knownType(head) === 'text') {
                if (arguments_.length !== 1) return undefined;
                const receiver = emit(head, lines, 'text'), index = emit(arguments_[0], lines, 'integer');
                if (!receiver || index?.type !== 'integer') return undefined;
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = textRead(${receiver.code}, ${index.code});`);
                return { code: name, type: 'text' };
            }
            if (!numberMode && host.nativeCalls && knownType(head) === 'bytes') {
                if (arguments_.length !== 1) return undefined;
                const receiver = emit(head, lines, 'bytes'), index = emit(arguments_[0], lines, 'integer');
                if (!receiver || index?.type !== 'integer') return undefined;
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = arrayRead(${receiver.code}, [${index.code}]);`);
                return { code: name, type: 'integer', selection: true };
            }
            // A failed call is not an array selection on a known scalar.
            if (localTypes.has(head.name)) return undefined;
            const previous = arrays.get(head.name);
            const kinds = current && isRankArray(current) && arrayRevision(current) !== undefined ? storedScalarKinds(current) : undefined;
            const kind = kinds?.length === 1 ? kinds[0] : undefined;
            const stored = kind === 'integer' || kind === 'boolean' || kind === 'text'
                || kind === 'real' && host.reals ? kind : undefined;
            const type = previous?.type ?? destinations.get(head.name)?.type ?? hint ?? stored ?? realInput(head.name) ?? 'integer';
            if (type === 'text' && (!host.nativeCalls || !host.textArrayLoops) || type === 'bytes') return undefined;
            if (hint && hint !== type || type === 'boolean' && !host.booleanArrays) return undefined;
            if (previous && previous.rank !== arguments_.length
                || destinations.has(head.name) && destinations.get(head.name)!.rank !== arguments_.length) return undefined;
            const indices: string[] = [];
            for (const argument of arguments_) {
                // A wide result needs exact loaded cells, but addresses still
                // belong to the checked Number backend (including row strides).
                const value: LoopTerm | undefined = wide && state.numberMode
                    ? createLoopExpressions(state).emit(argument, lines) : emit(argument, lines);
                if (value?.type !== 'integer') return undefined;
                indices.push(value.code);
            }
            const info = previous ?? { slot: slot(head.name), rank: indices.length, type };
            arrays.set(head.name, info);
            if (!assigned.has(head.name)) arrayInputs.add(head.name);
            const name = `v${state.serial++}`;
            if (state.numberMode) {
                const argument = arguments_[0];
                state.indexedReads.set(head.name, info.rank === 1 && !state.indexedReads.has(head.name) && isNameExpression(argument) ? argument.name : undefined);
                const offset = numberOffset(info, indices, lines);
                const cell = `cells${info.slot}[${offset}]`;
                const load = type === 'integer' ? wide ? `BigInt(${cell})` : `integerCell${info.slot}(${cell})`
                    : type === 'boolean' ? `Boolean(${cell})` : cell;
                lines.push(`const ${name} = ${load};`);
            } else {
                lines.push(`const ${name} = reader${info.slot}(${info.rank <= 2 ? indices.join(',') : `[${indices.join(',')}]`});`);
            }
            return { code: name, type, selection: true };
        }
        if (!isBinaryExpression(e) || e.step) return undefined;
        const membership = numericMembership(e);
        if (membership) {
            const key = emit(membership.key, lines);
            if (key?.type !== 'integer') return undefined;
            const call = numberMembershipCall(membership.name);
            return { code: `${membership.negate ? '!' : ''}calls[${call}](${key.code})`, type: 'boolean' };
        }
        if (['in', 'notin'].includes(e.operator) && isNameExpression(e.right)
            && (!numberMode || isRankIndex(host.read(e.right.name)!))) {
            const name = e.right.name;
            const key = emit(e.left, lines);
            if (key?.type !== 'integer') return undefined;
            const negate = e.operator === 'notin' ? '!' : '';
            if (host.sequenceMembership && !localTypes.has(name) && !arrays.has(name)
                && compiledIntegerMembership(host.read(name))) {
                const index = calls.length;
                calls.push({ name, locals: [], stableArrayReads: true, bind: () => {
                    const domain = host.read(name);
                    if (domain && isRankArray(domain) && (destinations.size || calls.some(call => !call.stableArrayReads))) return undefined;
                    return compiledIntegerMembership(domain);
                } });
                return { code: `${negate}calls[${index}](${key.code})`, type: 'boolean' };
            }
            if (isRankSet(host.read(name)!)) {
                const receiver = container(name, 'set');
                if (!receiver) return undefined;
                return { code: `${negate}setHas(${receiver}, ${key.code})`, type: 'boolean' };
            }
            const receiver = container(name, 'index');
            if (!receiver) return undefined;
            return { code: state.numberMode ? `${negate}${receiver}.has(key([${key.code}]))`
                : `${negate}indexHas(${receiver}, key([${key.code}]))`, type: 'boolean' };
        }
        if (isNameExpression(e.right) && ['reduce', 'scan', 'outer', 'segment'].includes(e.right.name)) return undefined;
        if (e.operator === '**') {
            let exponent = e.right;
            while (isParenthesizedExpression(exponent)) exponent = exponent.value;
            // Power binds before an unparenthesized sign, as in the evaluator.
            const signed = isUnaryExpression(e.left) && ['+', '-'].includes(e.left.operator) ? e.left : undefined;
            const base = emit(signed ? signed.operand : e.left, lines);
            if (!base) return undefined;
            // Publishing exact loops require nonnegative literals. Private
            // loops can guard computed exponents and replay negative ones.
            // Real powers have the evaluator's Number coercion and NaN check;
            // infinity is a valid result, and floor/ceil check it themselves.
            const exact = base.type === 'integer' && isNumberLiteral(exponent)
                && typeof exponent.value === 'bigint' && exponent.value >= 0n;
            const right = exact ? undefined : emit(e.right, lines);
            if (!exact && base.type === 'integer' && right?.type === 'integer' && (numberMode || wide)) {
                const name = `v${state.serial++}`;
                lines.push(`const ${name} = ${signed?.operator === '-' ? '-' : ''}${wide ? 'widePower' : 'power'}(${base.code}, ${right.code});`);
                return { code: name, type: 'integer' };
            }
            if (!exact && (!host.reals || !right || !loopOperatorSignature('**', [base.type, right.type], host.nativeCalls)
                || base.type === 'integer' && right.type === 'integer')) return undefined;
            const name = `v${state.serial++}`;
            const negative = signed?.operator === '-' ? '-' : '';
            if (exact && isNumberLiteral(exponent)) {
                const literal = exponent.value;
                // Keep trivial powers and squares inline; larger powers use
                // checked repeated squaring rather than approximate JS power.
                if (numberMode && literal > 2n) {
                    if (!Number.isSafeInteger(Number(literal))) return undefined;
                    lines.push(`const ${name} = ${negative}power(${base.code}, ${literal});`);
                    return { code: name, type: 'integer' };
                }
                const code = numberMode ? literal === 0n ? '1' : literal === 1n ? base.code : `(${base.code}) * (${base.code})`
                    : `(${base.code}) ** ${literal}n`;
                lines.push(`const ${name} = ${negative}(${safe(code)});`);
                return { code: name, type: 'integer' };
            }
            const power = arithmetic('**', base, right!, 'real', lines);
            if (power === undefined) return undefined;
            return { code: `${negative}(${power})`, type: 'real' };
        }
        return undefined;
    }
    return { isRange, rangeOperands, container, slot, knownType, realInput, emit, emitValue, arithmetic, numberOffset, arrayType, numberVectorLoop, numberVector };
}

export type LoopExpressions = ReturnType<typeof createLoopExpressions>;
