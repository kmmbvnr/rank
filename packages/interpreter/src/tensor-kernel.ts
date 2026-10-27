import { RankError } from './errors.js';
import { BooleanCells } from './boolean-cells.js';
import { ownedStorage } from './array-storage-state.js';
import { createOwned } from './owned-array.js';
import { binaryOperatorSource, scalarExtremeSource, zeroTestSource } from './operator-codegen.js';
import { tensorInput, validateTensorInputs } from './tensor-input.js';
import { applicationForm } from '@arrrank/language';
import { checkpoint, interruptsEnabled, privateLoopPolling, InterruptedError } from './interrupt.js';
import { currentDiagnostics, recordFallback } from './diagnostics.js';
import { compilerRejection } from './compiler-rejection.js';
import {
    flattenApplication, findOperation, unaryApplicationHead, findCompiledOperator, tensorOperatorSignatures, inferCompiledExpression, matchCompiledOperatorDomains,
    isApplicationExpression, isAssignmentStatement, isReturnStatement, isBinaryExpression,
    isNameExpression, isNumberLiteral, isFunctionOperator,
    isParenthesizedExpression, isUnaryExpression, isCountClauseExpression, isAllAxisExpression,
    type Expression, type Statement, type ReturnStatement, type CompiledAtomType, type CompiledExpression,
} from '@arrrank/language';
import { type RankValue, isRankArray, isRankSequence } from './value.js';
import { broadcastShape } from './tensor.js';
import { arraySliceLayout, reshapeDimensions, rankedBroadcastShapes } from './tensor-layout.js';
import { arrayRevision, ownedArray, ownedScalarArray, typedArray, IntegerCells } from './array-storage.js';
import { arithmeticRange, modularRange } from './range-plan.js';

type Terminal = 'copy' | 'sum' | 'mean' | 'any' | 'all' | 'count' | 'min' | 'max';
export type TensorReduction = Exclude<Terminal, 'copy'>;
const bitwiseTokens = { bxor: '^', band: '&', bor: '|' } as const;
type Bitwise = keyof typeof bitwiseTokens;
const bitwise = (name: string): name is Bitwise => Object.prototype.hasOwnProperty.call(bitwiseTokens, name);
const terminals = new Set(['copy', 'sum', 'mean', 'any', 'all', 'count', 'min', 'max']);
export type TensorNode =
    | { kind: 'input'; name?: string; value?: RankValue }
    | { kind: 'check'; source: TensorNode; validate(cell: RankValue, index: number): RankValue; uniform?: boolean }
    | { kind: 'call'; source: TensorNode; validate(cell: RankValue, index: number): RankValue }
    | { kind: 'shift'; source: TensorNode; fill: TensorNode; amount: number; axis: number }
    | { kind: 'view'; source: TensorNode; shape: readonly number[]; offset(index: number): number }
    | { kind: 'binary'; op: string; native?: Bitwise | 'min' | 'max'; ranks?: readonly [number, number]; left: TensorNode; right: TensorNode }
    | { kind: 'outer'; op: string; left: TensorNode; right: TensorNode }
    | { kind: 'reshape'; source: TensorNode; dimensions: (TensorNode | undefined)[] }
    | { kind: 'unary'; op: string; operand: TensorNode }
    | { kind: 'concat'; sources: TensorNode[]; axis?: number }
    | { kind: 'slice'; source: TensorNode; count: TensorNode; drop: boolean }
    | { kind: 'select'; source: TensorNode; selector: TensorNode };
export interface TensorKernelHost {
    readonly textDigits?: boolean;
    lookup(name: string): RankValue | undefined;
    builtin(name: Terminal | 'text' | 'integer' | 'reshape' | 'shift' | Bitwise): boolean;
    compiled?(source: string): void;
    valid?(): boolean;
}
type KernelResult = RankValue | RankValue[] | Float64Array | IntegerCells | BooleanCells | undefined;
type KernelRun = (data: ArrayLike<RankValue>[], offsets: number[], scalars: RankValue[], size: number,
    checks: ((cell: RankValue, index: number) => RankValue)[], routes: ((index: number) => number)[], start?: number,
    visit?: (cell: RankValue, index: number) => void) => KernelResult;
export interface TensorRange { readonly start: number; readonly size: number }
export type TensorCodeCache = Map<string, KernelRun>;

/** Native producers use the same IR, guards and emitter as source expressions.
 * Checks belong to this demand; the optional cache retains executable code only. */
export function compileNativeTensorReduction(root: TensorNode, operation: TensorReduction,
    domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>, host: TensorKernelHost, code: TensorCodeCache) {
    return build(root, operation, host, domains, false, code, true);
}
/** One source graph serves every cell of an axis fold. The frame index is a
 * runtime argument; source-axis traversal remains in natural row-major order. */
export function compileNativeTensorAxisReduction(root: TensorNode, operation: TensorReduction,
    axes: readonly number[], domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>,
    host: TensorKernelHost, code: TensorCodeCache) {
    return build(root, operation, host, domains, false, code, true, undefined, undefined, axes);
}
/** Completion consumes native recipes at the existing binding boundary. */
export function compileNativeTensorCopy(root: TensorNode,
    domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>, host: TensorKernelHost, code: TensorCodeCache) {
    return build(root, 'copy', host, domains, true, code, true);
}
/** A private consumer receives each computed integer directly, with no output buffer. */
export function compileNativeTensorVisit(root: TensorNode,
    domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>, host: TensorKernelHost, code: TensorCodeCache,
    visit: (cell: RankValue, index: number) => void) {
    return build(root, 'copy', host, domains, true, code, true, undefined, visit);
}
/** Integer prefix sums consume the native source directly into final storage. */
export function compileNativeIntegerScan(root: TensorNode, seed: bigint | undefined,
    domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>, host: TensorKernelHost, code: TensorCodeCache) {
    return build(root, 'copy', host, domains, true, code, true, seed ?? null);
}
const unwrap = (value: Expression): Expression => isParenthesizedExpression(value) ? unwrap(value.value) : value;
function pair(value: Expression): Expression[] | undefined {
    const atom = unwrap(value);
    return isApplicationExpression(atom) && atom.arguments.length === 1 ? [atom.head, atom.arguments[0]] : undefined;
}
const backing = (items: ArrayLike<RankValue>) => items instanceof BigInt64Array ? 'int64'
    : items instanceof Float64Array ? 'float64' : items instanceof Int32Array ? 'int32' : 'boxed';
interface View { items: ArrayLike<RankValue>; offset: number; shape: readonly number[]; kind?: string }
interface Bound { segments?: Bound[]; shape?: readonly number[]; operands?: readonly [readonly number[], readonly number[]]; boolean: boolean; slot?: number; view?: View; scalar?: RankValue; filter?: boolean; digits?: boolean; progression?: { start: number; step: number; divisor?: number } }
const numeric = (value: unknown) => typeof value === 'bigint' || typeof value === 'number' && Number.isFinite(value);
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/** Composable tensor expression IR. Shape binding is separate from emission;
 * unsupported layouts/values decline without evaluating user code or lazy data. */
export function compileTensorKernel(statement: Statement, host: TensorKernelHost): {
    source: string; run(): RankValue | undefined;
} | undefined {
    // Both plans parse the same statement: report its first rejection once.
    const attempt = { rejected: false };
    return compileTensorPlan(statement, host, attempt)
        ?? compileTensorPlan(statement, host, attempt, true);
}

/** A scalar demand may fuse its tensor expression without completing an array
 * result early. The caller still owns plan capture and binding validation. */
export function compileTensorReduction(expression: Expression, host: TensorKernelHost) {
    const parts = pair(unwrap(expression));
    const terminal = parts && unwrap(parts[1]);
    if (!terminal || !isNameExpression(terminal) || terminal.name === 'copy'
        || !terminals.has(terminal.name)) return undefined;
    // Boolean demands use the actual native graph: selection must validate its
    // indices before traversal, while pointwise maps may stop at the first answer.
    if (terminal.name === 'any' || terminal.name === 'all') return undefined;
    const statement = { $type: 'ReturnStatement', value: expression } as ReturnStatement;
    return compileTensorPlan(statement, host, { rejected: false });
}

function compileTensorPlan(statement: Statement, host: TensorKernelHost,
    attempt: { rejected: boolean }, implicit = false) {
    type Domain = readonly CompiledAtomType[];
    const domains = new Map<TensorNode, Domain>();
    const unknown: Domain = ['integer', 'real', 'boolean', 'text'];
    function reject(node: Expression | Statement, detail?: string): undefined {
        if (!attempt.rejected && currentDiagnostics()) recordFallback(compilerRejection('tensor', node, detail));
        attempt.rejected = true;
        return undefined;
    }
    function typed(node: TensorNode, domain: Domain): TensorNode {
        domains.set(node, domain);
        return node;
    }
    function parse(expression: Expression): TensorNode | undefined {
        const result = inferCompiledExpression<Domain, TensorNode>(expression, {
            atom: type => type === 'integer' || type === 'real' || type === 'boolean'
                || host.textDigits && type === 'text' ? [type] : undefined,
            read: source => {
                const input = parseInput(source);
                return input ? { type: domains.get(input)!, input } : undefined;
            },
            isBound: () => false,
            operator: (operation, inputs) => matchCompiledOperatorDomains(operation.tensor, inputs),
            call: (operation, inputs) => bitwise(operation.name)
                && inputs.length === 2 && inputs.every(domain => domain.includes('integer'))
                ? operation.compiledCall : undefined,
            budget: { remaining: 1024 },
        });
        if (result.failure) return reject(result.failure.source, result.failure.detail);
        return lower(result.expression);
    }
    function lower(node: CompiledExpression<Domain, TensorNode>): TensorNode | undefined {
        if (node.kind === 'extreme') return undefined; // Scalar extrema are not tensor capabilities.
        if (node.kind === 'group') return lower(node.operand);
        if (node.kind === 'input') return node.input;
        if (node.kind === 'literal') return typed({ kind: 'input', value: node.value }, node.type);
        if (node.kind === 'call') {
            if (!bitwise(node.operation.name)) return undefined;
            const left = lower(node.arguments[0]), right = lower(node.arguments[1]);
            return left && right ? typed({ kind: 'binary', op: node.operation.name,
                native: node.operation.name, left, right }, node.type) : undefined;
        }
        if (node.kind === 'unary') {
            const operand = lower(node.operand);
            return operand ? typed({ kind: 'unary', op: node.operation.name, operand }, node.type) : undefined;
        }
        const left = lower(node.left), right = lower(node.right);
        return left && right ? typed({ kind: 'binary', op: node.operation.name, left, right }, node.type) : undefined;
    }
    function parseInput(e: Expression): TensorNode | undefined {
        if (isCountClauseExpression(e)) {
            const source = parse(e.source), count = parse(e.count);
            return source && count ? typed({ kind: 'slice', source, count, drop: e.operator === 'drop' }, domains.get(source)!) : undefined;
        }
        const form = applicationForm(e, name => findOperation(name));
        const shiftParts = flattenApplication(e);
        const plainShift = shiftParts.length === 3 && isNameExpression(shiftParts[2]) && shiftParts[2].name === 'shift';
        if (plainShift || form.kind === 'axis-shift') {
            const sourceExpression = form.kind === 'axis-shift' ? form.source : shiftParts[0];
            const amountExpression = unwrap(form.kind === 'axis-shift' ? form.amount : shiftParts[1]);
            const signed = isUnaryExpression(amountExpression) && ['+', '-'].includes(amountExpression.operator)
                ? unwrap(amountExpression.operand) : amountExpression;
            if (!isNumberLiteral(signed) || typeof signed.value !== 'bigint') return undefined;
            const amount = Number(signed.value * (isUnaryExpression(amountExpression) && amountExpression.operator === '-' ? -1n : 1n));
            // Source syntax must not move a completed argument behind a shift.
            // Deferred expressions compose separately through their native recipe.
            const source = parse(sourceExpression);
            if (source?.kind !== 'input' || !Number.isSafeInteger(amount)) return undefined;
            const fill = form.kind === 'axis-shift' && form.fill ? parse(form.fill) : typed({ kind: 'input', value: 0n }, ['integer']);
            if (fill?.kind !== 'input') return undefined;
            return typed({ kind: 'shift', source, fill, amount, axis: form.kind === 'axis-shift' ? form.axis ?? 0 : 0 }, unknown);
        }
        if (form.kind === 'rank' && form.parts.length === 3 && form.rightRank !== undefined
            && isFunctionOperator(form.parts[2])) {
            const op = form.parts[2].operator;
            const left = parse(form.parts[0]), right = parse(form.parts[1]);
            const matched = left && right && matchCompiledOperatorDomains(tensorOperatorSignatures(op, 2),
                [domains.get(left)!, domains.get(right)!]);
            return matched ? typed({ kind: 'binary', op, left: left!, right: right!,
                ranks: [Number(form.rank), Number(form.rightRank)] }, matched.result) : undefined;
        }
        if (form.kind === 'outer' && form.operands.length === 2 && ['+', '-', '*'].includes(form.operator)) {
            const left = parse(form.operands[0]), right = parse(form.operands[1]);
            const matched = left && right && matchCompiledOperatorDomains(tensorOperatorSignatures(form.operator, 2),
                [domains.get(left)!, domains.get(right)!]);
            return matched ? typed({ kind: 'outer', op: form.operator, left: left!, right: right! }, matched.result) : undefined;
        }
        if (form.kind === 'reshape' && !form.rest.length) {
            const source = parse(form.source);
            const dimensions = form.dimensions.map(part => isAllAxisExpression(part) ? undefined : parse(part));
            if (!source || dimensions.some((node, index) => !node && !isAllAxisExpression(form.dimensions[index]))) return undefined;
            return typed({ kind: 'reshape', source, dimensions }, domains.get(source)!);
        }
        if (form.kind === 'array-combine-constructor' && form.operation === 'concat'
            && !form.axis && !form.rest.length) {
            const sources = form.items.map(item => parse(item));
            if (sources.some(node => !node)) return undefined;
            return typed({ kind: 'concat', sources: sources as TensorNode[] }, unknown);
        }
        if (isNameExpression(e) && !e.name.includes('.')) {
            return typed({ kind: 'input', name: e.name }, unknown);
        }
        // Rank gives power precedence over an unparenthesized sign.
        if (isBinaryExpression(e) && e.operator === '**' && !e.step && isUnaryExpression(e.left)
            && (e.left.operator === '+' || e.left.operator === '-')) {
            const left = parse(e.left.operand), right = parse(e.right);
            if (!left || !right) return undefined;
            const power = matchCompiledOperatorDomains(tensorOperatorSignatures('**', 2), [domains.get(left)!, domains.get(right)!]);
            if (!power) return undefined;
            const operand = typed({ kind: 'binary', op: '**', left, right }, power.result);
            const sign = matchCompiledOperatorDomains(tensorOperatorSignatures(e.left.operator, 1), [power.result]);
            return sign ? typed({ kind: 'unary', op: e.left.operator, operand }, sign.result) : undefined;
        }
        if (host.textDigits) {
            const parts = flattenApplication(e);
            if (parts.length === 4 && isNameExpression(parts[1]) && parts[1].name === 'integer'
                && isNameExpression(parts[2]) && parts[2].name === 'rank'
                && isNumberLiteral(parts[3]) && parts[3].value === 0n) {
                const operand = parse(parts[0]);
                return operand ? typed({ kind: 'unary', op: 'integer0', operand }, ['integer']) : undefined;
            }
            if (parts.length === 2 && isNameExpression(parts[1]) && parts[1].name === 'text') {
                const operand = parse(parts[0]);
                return operand ? typed({ kind: 'unary', op: 'text', operand }, ['text']) : undefined;
            }
        }
        // Native calls use the shared application frontend, not selection parsing.
        const last = flattenApplication(e).at(-1);
        if (last && isNameExpression(last) && bitwise(last.name)) return undefined;
        const parts = pair(e);
        if (parts) {
            const source = parse(parts[0]), selector = parse(parts[1]);
            return source && selector ? typed({ kind: 'select', source, selector }, domains.get(source)!) : undefined;
        }
        return undefined;
    }
    // A compound arithmetic assignment is one observable rebinding. Its old
    // value remains an input, never an output buffer or a private temporary.
    if (isAssignmentStatement(statement) && statement.deferred) return reject(statement, 'deferred-binding');
    if (implicit) {
        if (!(isAssignmentStatement(statement) && statement.operator === '=' && !statement.name.includes('.'))
            && !isReturnStatement(statement)) return undefined;
        if (!statement.value) return undefined;
        const root = parse(statement.value);
        let operations = 0;
        const arithmetic = (node: TensorNode): boolean => {
            if (node.kind === 'input') return true;
            if (node.kind === 'select') return arithmetic(node.source) && arithmetic(node.selector);
            if (node.kind === 'unary' && ['+', '-'].includes(node.op)) {
                operations++;
                return arithmetic(node.operand);
            }
            if (node.kind === 'binary' && !node.native && ['+', '-', '*', '/', '//', 'mod', '**'].includes(node.op)) {
                operations++;
                return arithmetic(node.left) && arithmetic(node.right);
            }
            return false;
        };
        if (!root || !arithmetic(root) || operations < 2) return undefined;
        return build(root, 'copy', host, domains, true);
    }
    if (isAssignmentStatement(statement) && ['+=', '-=', '*='].includes(statement.operator) && !statement.name.includes('.')) {
        const right = parse(statement.value);
        const arithmetic = (node: TensorNode): boolean => node.kind === 'input'
            || node.kind === 'unary' && ['+', '-'].includes(node.op) && arithmetic(node.operand)
            || node.kind === 'binary' && ['+', '-', '*'].includes(node.op) && arithmetic(node.left) && arithmetic(node.right);
        if (!right || !arithmetic(right)) return undefined;
        const left = typed({ kind: 'input', name: statement.name }, unknown);
        const op = statement.operator.slice(0, -1);
        const matched = matchCompiledOperatorDomains(tensorOperatorSignatures(op, 2), [unknown, domains.get(right)!]);
        if (!matched) return undefined;
        return build(typed({ kind: 'binary', op, left, right }, matched.result), 'copy', host, domains);
    }
    // An ordinary assignment completes its result before the next statement.
    // Only a single expression may enter this source frontend. Named deferred
    // stages compose through the checked native graph after normal demand.
    const assignment = isAssignmentStatement(statement) && statement.operator === '=';
    if ((!assignment && !isReturnStatement(statement)) || !statement.value) return undefined;
    const parts = pair(statement.value);
    const last = parts && unwrap(parts[1]);
    if (!last || !isNameExpression(last) || !terminals.has(last.name)) return undefined;
    // A dyadic overload such as `A 12 min` clips every cell; it is not
    // indexing followed by a monadic reduction. Parentheses retain the boundary.
    if (findOperation(last.name)?.arities.includes(2)
        && flattenApplication(unwrap(statement.value)).length !== 2
        && !unaryApplicationHead(unwrap(statement.value), name => findOperation(name)?.arities)) {
        return reject(statement, 'dyadic-terminal');
    }
    const root = parse(parts![0]);
    if (!root || root.kind === 'input') return undefined;
    return build(root, last.name as Terminal, host, domains);
}

function build(root: TensorNode, terminal: Terminal, host: TensorKernelHost,
    domains: ReadonlyMap<TensorNode, readonly CompiledAtomType[]>, implicit = false, code?: TensorCodeCache, nativeGraph = false,
    scan?: bigint | null, visit?: (cell: RankValue, index: number) => void, axes?: readonly number[]) {
    const scanning = scan !== undefined;
    const seeded = typeof scan === 'bigint';
    const outputDomain = domains.get(root);
    const integerOutput = outputDomain?.length === 1 && outputDomain[0] === 'integer';
    // Typed results are already complete. Boxed fallback retains its scalar proof.
    const copied = (items: RankValue[] | Float64Array | IntegerCells | BooleanCells, shape: readonly number[]): RankValue =>
        items instanceof BooleanCells ? createOwned(items, shape, true) : items instanceof IntegerCells ? items.array(shape) : items instanceof Float64Array ? typedArray(items, shape) : integerOutput
        ? ownedScalarArray(items, 'integer', shape) : ownedArray(items, shape, true);
    const nativeCalls = [...new Set([...domains.keys()].flatMap(node =>
        node.kind === 'binary' && node.native ? [node.native] : []))];
    const sequenceSelectors = new Set([...domains.keys()].flatMap(node =>
        node.kind === 'select' && node.selector.kind === 'input' ? [node.selector] : []));
    let cachedKey: string | undefined;
    const checkedNodes = [...domains.keys()].filter(node => node.kind === 'check' || node.kind === 'call');
    const checks = checkedNodes.map(node => node.validate);
    const checkSlots = new Map<TensorNode, number>(checkedNodes.map((node, index) => [node, index]));
    const hasCalls = checkedNodes.some(node => node.kind === 'call');
    function invoke(run: KernelRun, ...args: Parameters<KernelRun>): KernelResult {
        try { return run(...args); }
        catch (error) {
            if (hasCalls && error instanceof RankError && !(error instanceof InterruptedError)) return recordFallback('tensor:scalar-domain');
            throw error;
        }
    }
    const viewNodes = [...domains.keys()].filter(node => node.kind === 'view');
    const routes = viewNodes.map(node => node.offset);
    const routeSlots = new Map<TensorNode, number>(viewNodes.map((node, index) => [node, index]));
    let cachedRun: KernelRun | undefined;
    // Concat segment lengths vary between calls; retain bounded code layouts,
    // never source arrays, so recurring shapes do not recompile every step.
    const variants = new Map<string, { run: KernelRun; source: string }>();
    const hasConcat = [...domains.keys()].some(node => node.kind === 'concat');
    const hasSlices = [...domains.keys()].some(node => node.kind === 'slice');
    const hasShifts = [...domains.keys()].some(node => node.kind === 'shift');
    const structural = [...domains.keys()].filter(node => node.kind === 'outer' || node.kind === 'reshape');
    // Cache layout only: never retain operand storage or a previous result.
    // Selections and text conversions keep the general binder below.
    type InputLayout = { name?: string; value?: RankValue; slot: number; shape?: readonly number[]; boolean: boolean; kind?: string; storage?: string; scalarType?: string };
    type Layout = { inputs: InputLayout[]; offsets: number[]; shape: readonly number[]; size: number;
        interruptible: boolean; execute: KernelRun; source: string };
    let layout: Layout | undefined;
    const layouts = new Map<string, Layout>();
    const inputKey = (shape: readonly number[] | undefined, kind: string | undefined, boolean: boolean, slot: number, storage?: string, scalarType?: string) =>
        `${shape === undefined ? 's' : shape.join(',')}:${kind ?? ''}:${boolean}:${slot}:${storage ?? ''}:${scalarType ?? ''}`;
    let generated = '';
    let unavailable = false;
    return { get source() { return generated; }, run(range?: TensorRange, frame?: number): RankValue | undefined {
        if (axes && (!privateLoopPolling() || frame === undefined || !Number.isSafeInteger(frame) || frame < 0)) return undefined;
        if (range && (!nativeGraph || terminal !== 'all' && terminal !== 'any')) return undefined;
        if (host.valid?.() === false) return recordFallback('tensor:stale-input');
        if (implicit && !privateLoopPolling()) return recordFallback('tensor:observable-expression');
        if (hasSlices && !privateLoopPolling()) return recordFallback('tensor:observable-slices');
        if (hasShifts && !privateLoopPolling()) return recordFallback('tensor:observable-shift');
        if (structural.length && !privateLoopPolling()) return recordFallback('tensor:observable-structure');
        if (structural.some(node => node.kind === 'reshape') && !host.builtin('reshape')) return recordFallback('tensor:builtin:reshape');
        if (!nativeGraph && hasShifts && !host.builtin('shift')) return recordFallback('tensor:builtin:shift');
        for (const name of nativeCalls) if (!host.builtin(name)) return recordFallback(`tensor:builtin:${name}`);
        if (unavailable) return recordFallback('tensor:code-generation');
        // Native boolean recipes have word kernels. A scalar emitter would
        // unpack their advantage into one load/operation/store per bit.
        const booleanInput = (node: TensorNode): boolean => {
            if (node.kind === 'input') {
                const value = node.name === undefined ? node.value : host.lookup(node.name);
                return typeof value === 'boolean' || value !== undefined && isRankArray(value) && ownedStorage.get(value)?.stable === true
                    && ownedStorage.get(value)?.booleans !== undefined;
            }
            return node.kind === 'binary' && ['and', 'or', 'xor'].includes(node.op)
                ? booleanInput(node.left) && booleanInput(node.right)
                : node.kind === 'unary' && node.op === 'not' && booleanInput(node.operand);
        };
        if ((root.kind === 'binary' || root.kind === 'unary') && booleanInput(root)) return undefined;
        // Interrupt callbacks may enter this kernel again with another shape.
        const plan = layout;
        if (plan && plan.interruptible === interruptsEnabled() && (implicit || host.builtin(terminal))) {
            const data: ArrayLike<RankValue>[] = [], scalars: RankValue[] = [], offsets = [...plan.offsets];
            const keys: string[] | undefined = hasConcat ? [] : undefined;
            let validations: (() => void)[] | undefined;
            let matches = true;
            for (const input of plan.inputs) {
                const value = input.name === undefined ? input.value : host.lookup(input.name);
                if (input.shape) {
                    if (!value || !isRankArray(value) || !hasConcat && !same(value.shape, input.shape)) { matches = false; break; }
                    const view = tensorInput(value);
                    if (!view || !hasConcat && (view.kind !== input.kind || backing(view.items) !== input.storage
                        || (typeof view.items[view.offset] === 'boolean') !== input.boolean)) { matches = false; break; }
                    data[input.slot] = view.items;
                    offsets[input.slot] = view.offset;
                    if (view.validate) (validations ??= []).push(view.validate);
                    keys?.push(inputKey(view.shape, view.kind, typeof view.items[view.offset] === 'boolean', input.slot, backing(view.items)));
                } else {
                    if (!(numeric(value) || typeof value === 'boolean')
                        || !hasConcat && typeof value !== input.scalarType) { matches = false; break; }
                    scalars[input.slot] = value!;
                    keys?.push(inputKey(undefined, undefined, typeof value === 'boolean', input.slot, undefined, typeof value));
                }
            }
            if (matches) {
                const selected = keys ? layouts.get(String(plan.interruptible) + keys.join(';')) : plan;
                if (selected) {
                    if (!validateTensorInputs(validations)) return recordFallback('tensor:input-validation');
                    layout = selected;
                    generated = selected.source;
                    if (host.valid?.() === false) return recordFallback('tensor:stale-input');
                    const result = invoke(selected.execute, data, offsets, scalars, range ? range.start + range.size : selected.size, checks, routes, frame ?? range?.start, visit);
                    return terminal === 'copy' && !visit && result !== undefined
                        ? copied(result as RankValue[] | Float64Array | IntegerCells | BooleanCells, selected.shape) : result as RankValue | undefined;
                }
            }
        }
        return bindRun(range, frame);
    } };

    function bindRun(range?: TensorRange, frame?: number): RankValue | undefined {
        layout = undefined;
        const bound = new Map<TensorNode, Bound>();
        let broadcasts = false;
        const data: ArrayLike<RankValue>[] = [], offsets: number[] = [], scalars: RankValue[] = [];
        let validations: (() => void)[] | undefined;
        let bindingRejected = false;
        function rejectBinding(reason: string): undefined {
            if (!bindingRejected) recordFallback(reason);
            bindingRejected = true;
            return undefined;
        }
        function bind(node: TensorNode): Bound | undefined {
            const result = bindNode(node);
            if (!result && !bindingRejected) rejectBinding(`tensor:binding:${node.kind === 'binary' || node.kind === 'unary' ? node.op : node.kind === 'input' ? node.name ?? 'literal' : node.kind}`);
            return result;
        }
        function bindNode(node: TensorNode): Bound | undefined {
            if (bound.has(node)) return bound.get(node);
            let result: Bound | undefined;
            if (node.kind === 'input') {
                const value = node.name === undefined ? node.value : host.lookup(node.name);
                if (numeric(value) || typeof value === 'boolean' || host.textDigits && typeof value === 'string') {
                    result = { scalar: value, boolean: typeof value === 'boolean', slot: scalars.push(value!) - 1 };
                } else if (value && isRankSequence(value)) {
                    if (!sequenceSelectors.has(node)) return undefined;
                    const modular = modularRange(value.plan);
                    const range = modular ?? arithmeticRange(value.plan);
                    if (!range || range.count < 0n || range.count > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
                    result = { shape: [Number(range.count)], boolean: false, progression: {
                        start: scalars.push(range.start) - 1, step: scalars.push(range.step) - 1,
                        divisor: modular ? scalars.push(modular.divisor) - 1 : undefined,
                    } };
                } else if (value && isRankArray(value)) {
                    // Host-owned arrays can run getters while probing their
                    // cells. Only tracked storage is safe to inspect here.
                    if (structural.length && arrayRevision(value) === undefined) return rejectBinding('tensor:untracked-storage');
                    if (!value.shape.every(n => Number.isSafeInteger(n) && n >= 0)) return undefined;
                    const view = tensorInput(value);
                    if (!view) return arrayRevision(value) === undefined
                        ? rejectBinding('tensor:untracked-storage') : undefined;
                    if (view.validate) (validations ??= []).push(view.validate);
                    result = { shape: view.shape, view, boolean: typeof view.items[view.offset] === 'boolean' };
                }
            } else if (node.kind === 'check' || node.kind === 'call' || node.kind === 'view') {
                const source = bind(node.source);
                if (!source?.shape || source.filter || source.progression) return undefined;
                if (node.kind === 'view' && !Number.isSafeInteger(source.shape.reduce((size, n) => size * n, 1))) return undefined;
                const shape = node.kind === 'view' ? node.shape : source.shape;
                if (!shape.every(n => Number.isSafeInteger(n) && n >= 0)
                    || !Number.isSafeInteger(shape.reduce((size, n) => size * n, 1))) return undefined;
                result = { shape, boolean: node.kind === 'call' ? false : source.boolean };
            } else if (node.kind === 'shift') {
                const source = bind(node.source), fill = bind(node.fill);
                if (!source?.shape?.length || source.filter || source.progression || source.digits
                    || fill?.scalar === undefined || !Number.isSafeInteger(node.amount)
                    || node.axis < 0 || node.axis >= source.shape.length) return undefined;
                result = { shape: source.shape, boolean: source.boolean && fill.boolean };
            } else if (node.kind === 'slice') {
                const a = bind(node.source), b = bind(node.count);
                if (!a?.view || !a.shape?.length || typeof b?.scalar !== 'bigint' || b.scalar < 0n) return undefined;
                const sliced = arraySliceLayout(a.shape, b.scalar, node.drop);
                const view = { ...a.view, shape: sliced.shape, offset: a.view.offset + sliced.offset };
                result = { shape: view.shape, view, boolean: a.boolean };
            } else if (node.kind === 'concat') {
                const segments = node.sources.map(source => bind(source));
                const first = segments[0];
                if (nativeGraph) {
                    const axis = node.axis ?? 0;
                    if (!first?.shape?.length || axis < 0 || axis >= first.shape.length
                        || segments.some(segment => !segment?.shape || segment.filter || segment.progression || segment.digits
                            || segment.shape.length !== first.shape!.length
                            || segment.shape.some((n, i) => i !== axis && n !== first.shape![i]))) return undefined;
                    const shape = [...first.shape];
                    shape[axis] = segments.reduce((n, segment) => n + segment!.shape![axis], 0);
                    if (!Number.isSafeInteger(shape.reduce((n, size) => n * size, 1))) return undefined;
                    result = { shape, boolean: first.boolean };
                } else {
                    const kind = segments.find(segment => segment?.shape?.every(n => n > 0))?.view?.kind;
                    if (!first?.view || !first.shape?.length || segments.some(segment => !segment?.view
                        || segment.shape?.every(n => n > 0) && (!kind || segment.view.kind !== kind)
                        || segment.shape?.length !== first.shape!.length
                        || segment.shape.some((n, i) => i > 0 && n !== first.shape![i]))) return undefined;
                    result = { segments: segments as Bound[], boolean: first.boolean,
                        shape: [segments.reduce((n, segment) => n + segment!.shape![0], 0), ...first.shape.slice(1)] };
                    if (!Number.isSafeInteger(result.shape![0])) return undefined;
                }
            } else if (node.kind === 'outer') {
                const a = bind(node.left), b = bind(node.right);
                if (!a?.shape || !b?.shape || a.filter || b.filter || a.progression || b.progression) return undefined;
                const shape = [...a.shape, ...b.shape];
                if (!Number.isSafeInteger(shape.reduce((size, n) => size * n, 1))) return undefined;
                result = { shape, boolean: domains.get(node)!.every(type => type === 'boolean') };
            } else if (node.kind === 'reshape') {
                const a = bind(node.source);
                if (!a?.shape || a.filter || a.progression) return undefined;
                const dimensions: (RankValue | undefined)[] = [];
                for (const dimension of node.dimensions) {
                    const value = dimension && bind(dimension);
                    if (dimension && (value?.shape || typeof value?.scalar !== 'bigint')) return undefined;
                    dimensions.push(value?.scalar);
                }
                const count = a.shape.reduce((size, n) => size * BigInt(n), 1n);
                let shape: number[];
                try { shape = reshapeDimensions(dimensions, () => count); } catch { return undefined; }
                if (shape.reduce((size, n) => size * BigInt(n), 1n) !== count) return undefined;
                result = { shape, boolean: a.boolean };
            } else if (node.kind === 'binary') {
                const a = bind(node.left), b = bind(node.right);
                // Sequence arithmetic zips streams; it does not broadcast like
                // arrays. Proved progressions are used only as gather selectors.
                if (!a || !b || a.progression || b.progression) return undefined;
                let shape = a.shape ?? b.shape;
                let operands: Bound['operands'];
                if (node.ranks) {
                    try {
                        const aligned = rankedBroadcastShapes(a.shape ?? [], b.shape ?? [], node.ranks);
                        shape = a.shape || b.shape ? aligned.shape : undefined;
                        operands = [aligned.left, aligned.right];
                    } catch { return undefined; }
                    broadcasts = true;
                } else if (a.shape && b.shape && !same(a.shape, b.shape)) {
                    try { shape = broadcastShape(a.shape, b.shape); }
                    catch { return undefined; }
                    broadcasts = true;
                }
                result = { shape, operands, boolean: domains.get(node)!.every(type => type === 'boolean') };
            } else if (node.kind === 'unary') {
                const a = bind(node.operand);
                if (a?.progression) return undefined;
                if (node.op === 'text') {
                    if (a && typeof a.scalar === 'bigint' && host.builtin('text')) {
                        const value = a.scalar.toString();
                        result = { scalar: value, boolean: false, slot: scalars.push(value) - 1 };
                    }
                } else if (node.op === 'integer0') {
                    if (a && typeof a.scalar === 'string' && !/[^0-9]/.test(a.scalar) && host.builtin('integer')) {
                        result = { shape: [a.scalar.length], boolean: false, digits: true, slot: scalars.push(a.scalar) - 1 };
                    }
                } else if (a) result = { shape: a.shape, boolean: domains.get(node)!.every(type => type === 'boolean') };
            } else {
                const a = bind(node.source), b = bind(node.selector);
                if (!a || !b || a.progression || !a.shape || a.shape.length === 0) return undefined;
                if (typeof b.scalar === 'bigint' && a.view && b.scalar >= 0n && b.scalar < BigInt(a.shape[0])) {
                    const shape = a.shape.slice(1);
                    const stride = shape.reduce((p, n) => p * n, 1);
                    const view = { ...a.view, shape, offset: a.view.offset + Number(b.scalar) * stride };
                    if (shape.length === 0) {
                        const scalar = view.items instanceof Int32Array ? BigInt(view.items[view.offset]) : view.items[view.offset];
                        if (!numeric(scalar) && typeof scalar !== 'boolean') return undefined;
                        result = { scalar, boolean: typeof scalar === 'boolean', slot: scalars.push(scalar) - 1 };
                    } else result = { shape, view, boolean: typeof view.items[view.offset] === 'boolean' };
                } else if (b.shape && b.boolean && a.shape.length === 1 && same(a.shape, b.shape)) {
                    result = { shape: a.shape, boolean: a.boolean, filter: true };
                } else if (b.shape?.length === 1 && !b.boolean && a.view && a.shape.length === 1) {
                    result = { shape: b.shape, boolean: a.boolean };
                }
            }
            // Fold only total numeric arithmetic, before entering the array
            // domain. Other scalar operations retain the reference timing path.
            if (result && result.shape === undefined && result.scalar === undefined) {
                let scalar: RankValue | undefined;
                if (node.kind === 'binary' && ['+', '-', '*'].includes(node.op)) {
                    const a = bound.get(node.left)?.scalar, b = bound.get(node.right)?.scalar;
                    if (numeric(a) && numeric(b)) {
                        if (typeof a === 'bigint' && typeof b === 'bigint') scalar = node.op === '+' ? a+b : node.op === '-' ? a-b : a*b;
                        else scalar = node.op === '+' ? Number(a)+Number(b) : node.op === '-' ? Number(a)-Number(b) : Number(a)*Number(b);
                    }
                } else if (node.kind === 'unary' && ['+', '-'].includes(node.op)) {
                    const a = bound.get(node.operand)?.scalar;
                    if (numeric(a)) scalar = node.op === '+' ? a : typeof a === 'bigint' ? -a : -Number(a);
                }
                if (scalar !== undefined && numeric(scalar)) result = { scalar, boolean: false, slot: scalars.push(scalar)-1 };
            }
            // Remaining scalar computations must also run before an empty or
            // fully filtered domain. Leave unsupported lowering to reference.
            if (result && result.shape === undefined && result.scalar === undefined) return rejectBinding('tensor:scalar-evaluation-timing');
            if (result) {
                if (result.view) {
                    result.slot = data.push(result.view.items) - 1;
                    offsets.push(result.view.offset);
                }
                bound.set(node, result);
            }
            return result;
        }
        const output = bind(root);
        if (!output) return undefined;
        // Source structural expressions may complete arguments before a filter.
        // Only total integer expressions can move behind it. A native outer
        // producer already has lazy scalar addressing and completes neither side.
        function totalInteger(node: TensorNode): boolean {
            const info = bound.get(node);
            if (!info) return false;
            if (node.kind === 'input') return typeof info.scalar === 'bigint' || info.view?.kind === 'integer'
                || !!info.view?.shape.some(n => n === 0);
            if (node.kind === 'shift') return totalInteger(node.source) && totalInteger(node.fill);
            if (node.kind === 'reshape') return totalInteger(node.source);
            if (node.kind === 'check' || node.kind === 'view') return totalInteger(node.source);
            if (node.kind === 'unary') return ['+', '-'].includes(node.op) && totalInteger(node.operand);
            if (node.kind === 'binary' || node.kind === 'outer') {
                return (['+', '-', '*'].includes(node.op) || node.kind === 'binary' && !!node.native)
                    && totalInteger(node.left) && totalInteger(node.right);
            }
            return false;
        }
        if (structural.some(node => (node.kind === 'reshape' || !nativeGraph) && !totalInteger(node))) return recordFallback('tensor:structural-domain');
        if (!output.shape) return recordFallback('tensor:output-shape');
        if (!implicit && !host.builtin(terminal)) return recordFallback(`tensor:builtin:${terminal}`);
        // A gather preserves its selector's frame: broadcast its selector,
        // then use that value to address the source, never broadcast the table.
        // Filters change cardinality and still require a separate domain plan.
        if (broadcasts && [...bound.values()].some(info => info.filter || info.digits)) {
            return recordFallback('tensor:broadcast-selection');
        }
        const size = output.shape.reduce((p, n) => p * n, 1);
        // Even an empty array must evaluate scalar subexpressions that can
        // fail, such as A * (1 // 0). Let the reference path locate that error.
        if (implicit && size === 0 && [...domains.keys()].some(node =>
            node.kind === 'binary' && ['/', '//', 'mod', '**'].includes(node.op))) {
            return recordFallback('tensor:empty-arithmetic-domain');
        }
        // A selection changes cardinality. Other operands must not zip an
        // unfiltered vector against it. Until domain algebra is implemented,
        // only scalar maps and gathers can follow a filter.
        const filtered = new Map<TensorNode, boolean>();
        function domain(node: TensorNode): boolean {
            if (filtered.has(node)) return filtered.get(node)!;
            let value = bound.get(node)?.filter ?? false;
            if (node.kind === 'unary') value ||= domain(node.operand);
            if (node.kind === 'check' || node.kind === 'call' || node.kind === 'view') value ||= domain(node.source);
            if (node.kind === 'reshape') {
                if (domain(node.source)) throw false;
            }
            if (node.kind === 'outer') {
                if (domain(node.left) || domain(node.right)) throw false;
            }
            if (node.kind === 'shift' && domain(node.source)) throw false;
            if (node.kind === 'concat' && node.sources.some(domain)) throw false;
            if (node.kind === 'select') value ||= domain(node.selector);
            if (node.kind === 'binary') {
                const a = domain(node.left), b = domain(node.right);
                if (a && bound.get(node.right)?.shape || b && bound.get(node.left)?.shape) throw false;
                value ||= a || b;
            }
            filtered.set(node, value);
            return value;
        }
        try { domain(root); } catch { return recordFallback('tensor:filtered-domain'); }
        const compact = terminal === 'copy' && domain(root);
        if (implicit && compact) return recordFallback('tensor:implicit-filter');
        const resolved = new Map<TensorNode, readonly CompiledAtomType[]>();
        function outputTypes(node: TensorNode): readonly CompiledAtomType[] {
            const previous = resolved.get(node);
            if (previous) return previous;
            const info = bound.get(node)!;
            let types = domains.get(node)!;
            if (info.scalar !== undefined) types = [typeof info.scalar === 'bigint' ? 'integer'
                : typeof info.scalar === 'number' ? 'real' : typeof info.scalar === 'boolean' ? 'boolean' : 'text'];
            else if (info.view?.kind) types = [info.view.kind as CompiledAtomType];
            else if (info.progression || info.digits) types = ['integer'];
            else if (node.kind === 'binary' || node.kind === 'outer') types = matchCompiledOperatorDomains(
                tensorOperatorSignatures(node.op, 2), [outputTypes(node.left), outputTypes(node.right)])?.result ?? types;
            else if (node.kind === 'unary') types = matchCompiledOperatorDomains(
                tensorOperatorSignatures(node.op, 1), [outputTypes(node.operand)])?.result ?? types;
            else if (node.kind === 'shift') types = [...new Set([...outputTypes(node.source), ...outputTypes(node.fill)])];
            else if (node.kind === 'select' || node.kind === 'reshape' || node.kind === 'slice' || node.kind === 'view') types = outputTypes(node.source);
            resolved.set(node, types);
            return types;
        }
        const types = terminal === 'copy' && !compact ? outputTypes(root) : [];
        const outputKind = terminal === 'copy' && !compact && types.length === 1 ? types[0] : undefined;
        const interruptible = interruptsEnabled();
        const key = String(interruptible) + [...bound.values()].map(b => `${b.shape === undefined ? 's' : b.shape.join(',')}:${b.view ? backing(b.view.items) + ':' + b.view.kind : typeof b.scalar}:${b.boolean}:${b.filter ?? false}:${b.slot ?? ''}:${b.progression ? `${b.progression.start},${b.progression.step},${b.progression.divisor ?? ''}` : ''}`).join(';');
        let execute = cachedRun;
        const variant = variants.get(key);
        if (variant) { execute = variant.run; generated = variant.source; cachedKey = key; cachedRun = execute; }
        if (cachedKey !== key) {
            const lines: string[] = [];
            let emitted = new Map<TensorNode, Map<string, string>>();
            let serial = 0;
            const num = (x: string) => `(typeof ${x} === 'bigint' || typeof ${x} === 'number' && Number.isFinite(${x}))`;
            function address(shape: readonly number[], target: readonly number[], index: string): string {
                if (same(shape, target)) return index;
                let sourceStride = 1, targetStride = 1;
                const terms: string[] = [];
                for (let axis = target.length - 1; axis >= 0; axis--) {
                    const sourceAxis = axis - (target.length - shape.length);
                    if (sourceAxis >= 0) {
                        const dimension = shape[sourceAxis];
                        if (dimension !== 1) {
                            const coordinate = targetStride === 1 ? `(${index})` : `Math.floor((${index}) / ${targetStride})`;
                            terms.push(`(${coordinate} % ${target[axis]}) * ${sourceStride}`);
                        }
                        sourceStride *= dimension;
                    }
                    targetStride *= target[axis];
                }
                return terms.join(' + ') || '0';
            }
            const load = (slot: number | undefined, index: string): string => {
                const read = `data[${slot}][offsets[${slot}] + (${index})]`;
                return data[slot!] instanceof Int32Array ? `BigInt(${read})` : read;
            };
            function emit(node: TensorNode, index = 'i', frame = output!.shape!): string {
                const info = bound.get(node)!;
                const at = info.shape ? address(info.shape, frame, index) : '0';
                const existing = emitted.get(node)?.get(at);
                if (existing) return existing;
                const name = `v${serial++}`;
                let entries = emitted.get(node);
                if (!entries) emitted.set(node, entries = new Map());
                entries.set(at, name);
                const child = (operand: TensorNode) => emit(operand, at, info.shape ?? frame);
                if (info.scalar !== undefined) lines.push(`const ${name} = scalars[${info.slot}];`);
                else if (info.progression) {
                    const { start, step, divisor } = info.progression;
                    lines.push(`const ${name}raw = scalars[${start}] + BigInt(${at}) * scalars[${step}];`);
                    if (divisor === undefined) lines.push(`const ${name} = ${name}raw;`);
                    else {
                        lines.push(`const ${name}rem = ${name}raw % scalars[${divisor}];`);
                        lines.push(`const ${name} = ${binaryOperatorSource(findCompiledOperator('mod')!, `${name}raw`, `scalars[${divisor}]`, { remainder: `${name}rem` })};`);
                    }
                }
                else if (info.digits) lines.push(`const ${name} = BigInt(scalars[${info.slot}].charCodeAt(${at}) - 48);`);
                else if (info.view) lines.push(`const ${name} = ${load(info.slot, at)};`);
                else if (info.segments) {
                    const index = `(${at})`;
                    let end = 0;
                    const parts = info.segments.map((segment, position) => {
                        const start = end;
                        end += segment.shape!.reduce((n, dimension) => n * dimension, 1);
                        const read = load(segment.slot, `${index} - ${start}`);
                        return position === info.segments!.length - 1 ? read : `${index} < ${end} ? ${read} : `;
                    });
                    lines.push(`const ${name} = ${parts.join('')};`);
                }
                else if (node.kind === 'shift') {
                    const shape = info.shape!;
                    const width = shape[node.axis];
                    const stride = shape.slice(node.axis + 1).reduce((n, size) => n * size, 1);
                    // Clamp before multiplying: oversized safe-integer shifts
                    // only select fill, without overflowing the address math.
                    const amount = Math.max(-width, Math.min(width, node.amount));
                    const position = `p${serial++}`;
                    lines.push(`const ${position} = Math.floor((${at}) / ${stride}) % ${width} - (${amount});`, `let ${name};`);
                    lines.push(`if (${position} < 0 || ${position} >= ${width}) {`);
                    const saved = emitted;
                    emitted = new Map();
                    const fill = emit(node.fill);
                    lines.push(`${name} = ${fill};`, '} else {');
                    emitted = new Map();
                    const source = emit(node.source, `((${at}) - (${amount * stride}))`, shape);
                    emitted = saved;
                    lines.push(`${name} = ${source};`, '}');
                }
                else if (node.kind === 'concat') {
                    const axis = node.axis ?? 0;
                    const shape = info.shape!;
                    const inner = shape.slice(axis + 1).reduce((n, size) => n * size, 1);
                    const width = shape[axis];
                    const position = `p${serial++}`;
                    lines.push(`const ${position} = Math.floor((${at}) / ${inner}) % ${width};`, `let ${name};`);
                    let start = 0;
                    for (const source of node.sources) {
                        const sourceShape = bound.get(source)!.shape!;
                        const length = sourceShape[axis];
                        if (!length) continue;
                        lines.push(`if (${position} >= ${start} && ${position} < ${start + length}) {`);
                        // A later segment must not compute or fail before it is
                        // visited. Branch-local temporaries cannot escape here.
                        const saved = emitted;
                        emitted = new Map();
                        const index = `(Math.floor((${at}) / ${width * inner}) * ${length} + ${position} - ${start}) * ${inner} + ((${at}) % ${inner})`;
                        const cell = emit(source, index, sourceShape);
                        emitted = saved;
                        lines.push(`${name} = ${cell};`, '}');
                        start += length;
                    }
                }
                else if (node.kind === 'check' || node.kind === 'call') {
                    const source = child(node.source);
                    lines.push(`const ${name} = checks[${checkSlots.get(node)}](${source}, ${at});`);
                }
                else if (node.kind === 'view') {
                    const position = `p${serial++}`;
                    const sourceShape = bound.get(node.source)!.shape!;
                    const sourceSize = sourceShape.reduce((size, n) => size * n, 1);
                    lines.push(`const ${position} = routes[${routeSlots.get(node)}](${at});`);
                    lines.push(`if (!Number.isSafeInteger(${position}) || ${position} < 0 || ${position} >= ${sourceSize}) return decline('tensor:view-index');`);
                    const source = emit(node.source, position, sourceShape);
                    lines.push(`const ${name} = ${source};`);
                }
                else if (node.kind === 'reshape') {
                    const source = emit(node.source, at, bound.get(node.source)!.shape!);
                    lines.push(`const ${name} = ${source};`);
                }
                else if (node.kind === 'binary' || node.kind === 'outer') {
                    const rankedChild = (operand: TensorNode, shape: readonly number[]) => emit(operand,
                        address(shape, info.shape ?? [], at), bound.get(operand)!.shape ?? []);
                    const rightSize = node.kind === 'outer'
                        ? bound.get(node.right)!.shape!.reduce((size, n) => size * n, 1) : 0;
                    const a = node.kind === 'outer'
                        ? emit(node.left, `Math.floor((${at}) / ${rightSize})`, bound.get(node.left)!.shape!)
                        : info.operands ? rankedChild(node.left, info.operands[0]) : child(node.left);
                    const b = node.kind === 'outer'
                        ? emit(node.right, `((${at}) % ${rightSize})`, bound.get(node.right)!.shape!)
                        : info.operands ? rankedChild(node.right, info.operands[1]) : child(node.right);
                    const decline = `return decline(${JSON.stringify(`tensor:operator-guard:${node.op}`)});`;
                    if (node.kind === 'binary' && (node.native === 'min' || node.native === 'max')) {
                        lines.push(`if (!${num(a)} || !${num(b)} || typeof ${a} !== typeof ${b}) ${decline}`);
                        lines.push(`const ${name} = ${scalarExtremeSource(node.native, a, b)};`);
                        return name;
                    }
                    if (node.kind === 'binary' && node.native && bitwise(node.native)) {
                        lines.push(`if (typeof ${a} !== 'bigint' || typeof ${b} !== 'bigint') ${decline}`);
                        lines.push(`const ${name} = ${a} ${bitwiseTokens[node.native]} ${b};`);
                        return name;
                    }
                    const signatures = tensorOperatorSignatures(node.op, 2);
                    const operation = findCompiledOperator(node.op)!;
                    if (node.op === 'mod' || node.op === '//') {
                        lines.push(`if (typeof ${a} !== 'bigint' || typeof ${b} !== 'bigint' || ${zeroTestSource(b, 'integer')}) ${decline}`);
                        lines.push(`const ${name}rem = ${a} % ${b};`);
                        lines.push(`const ${name} = ${binaryOperatorSource(operation, a, b, { remainder: `${name}rem` })};`);
                        return name;
                    }
                    if (signatures.every(signature => signature.inputs[0] === 'boolean')) {
                        lines.push(`if (typeof ${a} !== 'boolean' || typeof ${b} !== 'boolean') ${decline}`);
                        lines.push(`const ${name} = ${binaryOperatorSource(operation, a, b)};`);
                    } else {
                        lines.push(`if (!${num(a)} || !${num(b)}) ${decline}`);
                        if (signatures.every(signature => signature.result === 'boolean')) {
                            lines.push(`if (typeof ${a} !== typeof ${b}) ${decline}`);
                            lines.push(`const ${name} = ${binaryOperatorSource(operation, a, b)};`);
                        } else {
                            if (node.op === '/') lines.push(`if (${zeroTestSource(b, 'numeric')}) ${decline}`);
                            if (node.op === '**') lines.push(`if (${b} < 0 || ${b} > 1024 || (typeof ${b} === 'number' && !Number.isInteger(${b}))) ${decline}`);
                            const expr = binaryOperatorSource(operation, `Number(${a})`, `Number(${b})`);
                            lines.push(`const ${name} = ${node.op === '/' ? expr : `(typeof ${a} === 'bigint' && typeof ${b} === 'bigint' ? ${binaryOperatorSource(operation, a, b)} : ${expr})`};`);
                        }
                    }
                } else if (node.kind === 'unary') {
                    const a = child(node.operand);
                    const decline = `return decline(${JSON.stringify(`tensor:operator-guard:${node.op}`)});`;
                    const boolean = tensorOperatorSignatures(node.op, 1).every(signature => signature.inputs[0] === 'boolean');
                    lines.push(`if (${boolean ? `typeof ${a} !== 'boolean'` : `!${num(a)}`}) ${decline}`);
                    lines.push(`const ${name} = ${findCompiledOperator(node.op)!.unary}${a};`);
                } else if (node.kind === 'select') {
                    const b = child(node.selector);
                    const decline = `return decline('tensor:selection-guard');`;
                    if (info.filter) {
                        lines.push(`if (typeof ${b} !== 'boolean') ${decline} if (!${b}) continue;`);
                        const a = child(node.source);
                        lines.push(`const ${name} = ${a};`);
                    } else {
                        const source = bound.get(node.source)!;
                        lines.push(`if (typeof ${b} !== 'bigint' || ${b} < 0n || ${b} >= BigInt(${source.shape![0]})) ${decline}`);
                        lines.push(`const ${name} = ${load(source.slot, `Number(${b})`)};`);
                    }
                }
                return name;
            }
            const value = emit(root);
            const isBoolean = terminal === 'copy' ? output.boolean : ['any', 'all', 'count'].includes(terminal);
            lines.push(`if (${isBoolean ? `typeof ${value} !== 'boolean'` : `!${num(value)}`}) return decline('tensor:terminal-type:${terminal}');`);
            if (scanning) lines.push(`if (typeof ${value} !== 'bigint') return decline('tensor:scan-type');`,
                seeded ? `accumulated += ${value};` : `accumulated = i === 0 ? ${value} : accumulated + ${value};`,
                `answer.set(i + ${seeded ? 1 : 0}, accumulated);`);
            else if (visit) lines.push(`visit(${value}, i);`);
            else if (terminal === 'copy') lines.push(outputKind === 'boolean' ? `answer.write(i, ${value});` : outputKind === 'integer' ? `answer.set(i, ${value});`
                : compact ? `answer.push(${value});` : `answer[i] = ${value};`);
            if (terminal === 'sum') lines.push(`answer = typeof answer === 'bigint' && typeof ${value} === 'bigint' ? answer + ${value} : Number(answer) + Number(${value});`);
            if (terminal === 'mean') lines.push(`answer += Number(${value});`);
            if (terminal === 'count') lines.push(`if (${value}) answer += 1n;`);
            if (terminal === 'any' || terminal === 'all') lines.push(nativeGraph
                ? `if (${terminal === 'any' ? value : `!${value}`}) return ${terminal === 'any'};`
                : `answer = answer ${terminal === 'any' ? '||' : '&&'} ${value};`);
            if (terminal === 'min' || terminal === 'max') lines.push(`if (length === 0 || ${value} ${terminal === 'min' ? '<' : '>'} answer) answer = ${value};`);
            lines.push('length++;');
            const initial = visit ? 'true' : scanning ? `new IntegerCells(size + ${seeded ? 1 : 0})`
                : terminal === 'copy' ? outputKind === 'boolean' ? 'new BooleanCells(size)' : outputKind === 'integer' ? 'new IntegerCells(size)' : outputKind === 'real' ? 'new Float64Array(size)' : compact ? '[]' : 'new Array(size)' : terminal === 'mean' ? '0' : terminal === 'all' ? 'true' : terminal === 'any' ? 'false' : '0n';
            // Distinct functions keep each input load on one physical backing type,
            // including callers that share the source-text code cache.
            const prefix = scanning ? `let accumulated = ${seeded ? `${scan}n` : '0n'}; ${seeded ? 'answer.set(0, accumulated);' : ''}` : '';
            let loop = 'for (let i = start; i < size; i++) {';
            if (axes) {
                const shape = output.shape;
                const reduced = shape.map((_, axis) => axis).filter(axis => axes.includes(axis));
                const frames = shape.map((_, axis) => axis).filter(axis => !axes.includes(axis));
                const count = reduced.reduce((n, axis) => n * shape[axis], 1);
                const offset = (index: string, selected: readonly number[]): string => {
                    let stride = 1;
                    const terms: string[] = [];
                    for (let at = selected.length - 1; at >= 0; at--) {
                        const axis = selected[at];
                        const sourceStride = shape.slice(axis + 1).reduce((n, size) => n * size, 1);
                        terms.push(`(Math.floor(${index} / ${stride}) % ${shape[axis]}) * ${sourceStride}`);
                        stride *= shape[axis];
                    }
                    return terms.join(' + ') || '0';
                };
                const frameCount = frames.reduce((n, axis) => n * shape[axis], 1);
                loop = `if (start >= ${frameCount}) return decline('tensor:axis-frame');
                    const base = ${offset('start', frames)};
                    for (let cell = 0; cell < ${count}; cell++) {
                        const i = base + ${offset('cell', reduced)};`;
            }
            generated = `"use strict"; /* ${data.map(backing).join(',')} */ return function(data, offsets, scalars, size, checks, routes, start = 0, visit) { let answer = ${initial}, length = 0; ${prefix} ${loop} ${interruptible ? "checkpoint('computing tensor');" : ''}\n${lines.join('\n')}\n} ${['mean', 'min', 'max'].includes(terminal) ? `if (length === 0) return decline('tensor:empty-terminal:${terminal}');` : ''} return ${terminal === 'mean' ? 'answer / length' : 'answer'}; };`;
            execute = code?.get(generated);
            const compiled = !execute;
            if (!execute) {
                try { execute = new Function('checkpoint', 'decline', 'IntegerCells', 'BooleanCells', generated)(checkpoint, recordFallback, IntegerCells, BooleanCells) as KernelRun; }
                catch { unavailable = true; return recordFallback('tensor:code-generation'); }
                if (code) {
                    if (code.size >= 32) code.delete(code.keys().next().value!);
                    code.set(generated, execute);
                }
            }
            cachedKey = key;
            cachedRun = execute;
            if (compiled) host.compiled?.(generated);
            if ([...bound.keys()].some(node => node.kind === 'concat')) {
                if (variants.size >= 256) variants.delete(variants.keys().next().value!);
                variants.set(key, { run: execute!, source: generated });
            }
        }
        if (!scanning && !structural.length && [...bound.keys()].every(node => node.kind !== 'select' && node.kind !== 'slice'
            && !(node.kind === 'unary' && (node.op === 'text' || node.op === 'integer0')))
            && [...bound].every(([node, info]) => node.kind === 'input' || info.scalar === undefined)
            && [...bound.values()].every(info => !info.progression && (info.scalar === undefined || numeric(info.scalar) || typeof info.scalar === 'boolean'))) {
            layout = { inputs: [...bound].flatMap(([node, info]) => node.kind === 'input' ? [{
                name: node.name, value: node.value,
                slot: info.slot!, shape: info.shape && [...info.shape], boolean: info.boolean, kind: info.view?.kind, storage: info.view && backing(info.view.items), scalarType: info.shape ? undefined : typeof info.scalar,
            }] : []), offsets: [...offsets], shape: [...output.shape], size, interruptible, execute: execute!, source: generated };
            if (hasConcat) {
                if (layouts.size >= 256) layouts.delete(layouts.keys().next().value!);
                layouts.set(String(interruptible) + layout.inputs.map(input =>
                    inputKey(input.shape, input.kind, input.boolean, input.slot, input.storage, input.scalarType)).join(';'), layout);
            }
        }
        if (!validateTensorInputs(validations)) return recordFallback('tensor:input-validation');
        if (host.valid?.() === false) return recordFallback('tensor:stale-input');
        const result = invoke(execute!, data, offsets, scalars, range ? range.start + range.size : size, checks, routes, frame ?? range?.start, visit);
        if (terminal === 'copy' && !visit && result !== undefined) {
            return copied(result as RankValue[] | Float64Array | IntegerCells | BooleanCells,
                scanning ? [size + (seeded ? 1 : 0)] : compact ? [(result as RankValue[]).length] : output.shape);
        }
        return result as RankValue | undefined;
    }
}
