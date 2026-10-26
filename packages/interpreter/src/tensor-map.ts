import { registerPackedBooleanMap, countPackedBooleans } from './packed-booleans.js';
import { matchCompiledOperatorDomains, tensorOperatorSignatures, type CompiledAtomType } from '@arrrank/language';
import { arrayCellValidator } from './derived-array.js';
import { checkpoint } from './interrupt.js';
import { currentDiagnostics } from './diagnostics.js';
import { prepareNativeScalarView, prepareIntegerView, prepareStoredScalarView } from './integer-view.js';
import { arrayRevision } from './array-revision.js';
import { registerMappedArrayRange } from './range-plan.js';
import { compileNativeIntegerScan, compileNativeTensorCopy, compileNativeTensorVisit, compileNativeTensorReduction, type TensorCodeCache, type TensorKernelHost, type TensorNode, type TensorReduction, type TensorRange } from './tensor-kernel.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

interface MapRecipe {
    readonly reader: RankArray['itemAt'];
    readonly shape: readonly number[];
    readonly operator: string;
    readonly layout: 'broadcast' | 'outer';
    readonly operands: readonly RankValue[];
}
const maps = new WeakMap<RankArray, MapRecipe>();
const concats = new WeakMap<RankArray, { reader: RankArray['itemAt']; shape: readonly number[]; operands: readonly RankArray[]; axis: number }>();
const owners = new WeakMap<RankArray, PlanScope>();
const mapOperators = new Set(['+', '-', '*', '/', '//', 'mod', '**',
    'less', 'greater', 'atmost', 'atleast', 'equal', 'notequal', 'and', 'or', 'xor', 'not', 'integer0', 'min', 'max']);
const reductions: ReadonlySet<string> = new Set<TensorReduction>(['sum', 'mean', 'min', 'max', 'count', 'any', 'all']);
interface PlanScope {
    readonly host: TensorKernelHost;
    readonly code: TensorCodeCache;
    enabled(): boolean;
    executed(): void;
}
let active: PlanScope | undefined;
let consumerCompilation = true;

/** A host entry starts outside its caller's ambient plan. Its compilation policy
 * also applies to native values carrying an earlier compiler owner. */
export function withoutAmbientTensorPlan<T>(run: () => T, enabled = true): T {
    const previous = active;
    const previousCompilation = consumerCompilation;
    active = undefined;
    consumerCompilation = enabled;
    try { return run(); }
    finally { active = previous; consumerCompilation = previousCompilation; }
}

/** A demand owns temporary native values; its persistent scope retains code only.
 * Nested plans restore the consumer's scope before its reduction executes. */
export function tensorPlanScope(host: TensorKernelHost, enabled: () => boolean, executed: () => void,
    code: TensorCodeCache = new Map()): <T>(run: () => T) => T {
    const scope: PlanScope = { host, code, enabled, executed };
    return run => {
        const previous = active;
        active = scope;
        try { return run(); }
        finally { active = previous; }
    };
}

/** A native operand can carry a deferred recipe past its original demand. */
export function constructingTensorPlan(...operands: RankValue[]): boolean {
    return active !== undefined || operands.some(value => isRankArray(value) && mapScope(value)?.enabled());
}

/** Native view results keep their compiler owner for consumers after demand.
 * Stored results are boundaries and acquire no provenance from this operation. */
export function registerTensorResult(value: RankValue): RankValue {
    if (active?.enabled() && isRankArray(value) && prepareNativeScalarView(value)) owners.set(value, active);
    return value;
}

/** Only native scalar operators can publish a recipe. Host readers and callbacks
 * cannot acquire this capability by having a numeric result annotation. */
export function registerTensorMap<T extends RankValue>(value: T, operator: string, operands: readonly RankValue[],
    layout: 'broadcast' | 'outer' = 'broadcast'): T {
    if (!isRankArray(value) || !mapOperators.has(operator)) return value;
    if (layout === 'broadcast' && operands.length === 2) registerMappedArrayRange(value, operator, operands[0], operands[1]);
    if (layout === 'broadcast') registerPackedBooleanMap(value, operator, operands);
    let scope = active;
    if (!scope) for (const operand of operands) {
        if (isRankArray(operand)) scope = mapScope(operand);
        if (scope) break;
    }
    if (scope?.enabled()) {
        maps.set(value, { reader: value.itemAt, shape: [...value.shape], operator, operands, layout });
        owners.set(value, scope);
    }
    return value;
}

/** Concat has already checked shapes and the axis. Preserve only its native
 * recipe; lowering must still prove every leaf at the consumer's demand. */
export function registerTensorConcat(value: RankArray, operands: readonly RankArray[], axis: number): void {
    const scope = active ?? operands.map(mapScope).find(scope => scope?.enabled());
    if (!scope?.enabled()) return;
    concats.set(value, { reader: value.itemAt, shape: [...value.shape], operands, axis });
    owners.set(value, scope);
}

/** Lower actual, checked native arrays after normal plan demand. Never inspect
 * RankPlan.expression or evaluate a producer to make a speculative guard pass. */
export function materializeTensorMap(value: RankArray): RankArray | undefined {
    const result = consumeTensorMap(value, 'copy');
    return result !== undefined && isRankArray(result) ? result : undefined;
}

export function reduceTensorMap(value: RankArray, operation: string): RankValue | undefined {
    return consumeTensorMap(value, operation);
}

/** Only native integer graphs may feed a private collection consumer. A decline
 * discards its private state before ordinary traversal starts. */
export function visitIntegerTensorMap(value: RankArray, visit: (cell: bigint) => void): boolean {
    return prepareTensorMap(value, 'copy', undefined, cell => visit(cell as bigint))?.() !== undefined;
}

/** The scan owns its output; reshapes and other native views keep no buffers. */
export function scanTensorMap(value: RankArray, seed: RankValue | undefined): RankArray | undefined {
    if (seed !== undefined && typeof seed !== 'bigint') return undefined;
    const result = prepareTensorMap(value, 'copy', { seed })?.();
    return result !== undefined && isRankArray(result) ? result : undefined;
}

function consumeTensorMap(value: RankArray, operation: string): RankValue | undefined {
    if (operation === 'count') {
        const packed = countPackedBooleans(value);
        if (packed !== undefined) return packed;
    }
    return prepareTensorMap(value, operation)?.();
}

/** One native graph serves contiguous boolean cells, without completing later cells. */
export function prepareTensorBooleanRange(value: RankArray, operation: 'all' | 'any'):
    ((start: number, size: number) => RankValue | undefined) | undefined {
    const run = prepareTensorMap(value, operation);
    return run && ((start, size) => run({ start, size }));
}

function prepareTensorMap(value: RankArray, operation: string, scan?: { seed: bigint | undefined },
    visit?: (cell: RankValue) => void):
    ((range?: TensorRange) => RankValue | undefined) | undefined {
    if (!consumerCompilation || operation !== 'copy' && !reductions.has(operation)) return undefined;
    const scope = active ?? mapScope(value);
    if (!scope?.enabled()) return undefined;
    const textDigits = scope.host.textDigits;
    const domains = new Map<TensorNode, readonly CompiledAtomType[]>();
    const visiting = new Set<RankArray>();
    const guards: (() => boolean)[] = [];
    let remaining = 1024;
    let transformed = false;
    const typed = <T extends TensorNode>(node: T, domain: readonly CompiledAtomType[]): T => { domains.set(node, domain); return node; };
    function check(source: TensorNode, validate: ((cell: RankValue, index: number) => RankValue) | undefined): TensorNode {
        return validate ? typed({ kind: 'check', source, validate }, domains.get(source)!) : source;
    }
    function guardArray(value: RankArray): void {
        const reader = value.itemAt, shape = [...value.shape], revision = arrayRevision(value);
        guards.push(() => value.itemAt === reader && value.shape.length === shape.length
            && value.shape.every((n, axis) => n === shape[axis]) && arrayRevision(value) === revision);
    }
    function lower(value: RankValue): TensorNode | undefined {
        if (--remaining < 0) return undefined;
        checkpoint('preparing tensor map');
        if (typeof value === 'bigint') return typed({ kind: 'input', value }, ['integer']);
        if (typeof value === 'number' && Number.isFinite(value)) return typed({ kind: 'input', value }, ['real']);
        if (typeof value === 'boolean') return typed({ kind: 'input', value }, ['boolean']);
        if (typeof value === 'string' && textDigits) return typed({ kind: 'input', value }, ['text']);
        if (!isRankArray(value) || visiting.has(value)) return undefined;
        visiting.add(value);
        try {
            const view = prepareNativeScalarView(value);
            if (view === false) return undefined;
            if (view) {
                const source = lower(view.source);
                if (!source) return undefined;
                guards.push(view.valid);
                const identity = view.linear?.offset === 0 && view.linear.stride === 1
                    && view.shape.length === view.source.shape.length
                    && view.shape.every((n, axis) => n === view.source.shape[axis]);
                transformed ||= !identity;
                return check(identity ? source : typed({ kind: 'view', source, shape: view.shape, offset: view.offset },
                    domains.get(source)!), view.validate);
            }
            // Stored arrays are completion boundaries, even if their creation
            // had a recipe. Only their present storage may feed this demand.
            const stored = prepareStoredScalarView(value, true);
            if (stored?.kinds?.length === 0 && value.shape.some(n => n === 0)) {
                guardArray(value);
                return typed({ kind: 'input', value }, ['integer', 'real', 'boolean']);
            }
            // Other checked readers must retain their traversal order instead
            // of settling a contract before an earlier computed operand fails.
            if (stored?.validate) return undefined;
            if (stored?.kinds?.length
                && stored.kinds.every((kind): kind is CompiledAtomType => kind === 'integer' || kind === 'real' || kind === 'boolean')) {
                guardArray(value);
                return typed({ kind: 'input', value }, stored.kinds);
            }
            const concat = concats.get(value);
            if (concat && concat.reader === value.itemAt && concat.shape.length === value.shape.length
                && concat.shape.every((n, axis) => n === value.shape[axis])) {
                const sources: TensorNode[] = [];
                for (const operand of concat.operands) {
                    const source = lower(operand);
                    if (!source) return undefined;
                    sources.push(source);
                }
                guardArray(value);
                transformed = true;
                const source = typed({ kind: 'concat', sources, axis: concat.axis },
                    [...new Set(sources.flatMap(node => domains.get(node)!))]);
                const validate = arrayCellValidator(value);
                return check(source, validate && ((cell, index) => { validate(cell, index); return cell; }));
            }
            if (prepareIntegerView(value)) { guardArray(value); return typed({ kind: 'input', value }, ['integer']); }
            const map = maps.get(value);
            if (!map || map.reader !== value.itemAt || map.shape.length !== value.shape.length
                || map.shape.some((n, axis) => n !== value.shape[axis])) return undefined;
            guardArray(value);
            if (map.operands.length < 1 || map.operands.length > 2) return undefined;
            const operands: TensorNode[] = [];
            for (const operand of map.operands) {
                const node = lower(operand);
                if (!node) return undefined;
                operands.push(node);
            }
            if (map.operator === 'integer0') guards.push(() => scope!.host.builtin('integer'));
            const extreme = map.operator === 'min' || map.operator === 'max';
            if (extreme && map.layout !== 'broadcast') return undefined;
            const matched = extreme
                ? operands.length === 2 && operands.every(node => domains.get(node)!.every(type => type === 'integer' || type === 'real'))
                    ? { result: [...new Set(operands.flatMap(node => domains.get(node)!))] } : undefined
                : map.operator === 'integer0' && operands.length === 1 && textDigits
                ? { result: ['integer'] as const }
                : matchCompiledOperatorDomains(tensorOperatorSignatures(map.operator, operands.length),
                    operands.map(node => domains.get(node)!));
            if (!matched) return undefined;
            transformed = true;
            const node = typed(operands.length === 1 ? { kind: 'unary', op: map.operator, operand: operands[0]! }
                : extreme ? { kind: 'binary', op: map.operator, native: map.operator as 'min' | 'max', left: operands[0]!, right: operands[1]! }
                : { kind: map.layout === 'outer' ? 'outer' : 'binary', op: map.operator, left: operands[0]!, right: operands[1]! }, matched.result);
            const validate = arrayCellValidator(value);
            return check(node, validate && ((cell, index) => { validate(cell, index); return cell; }));
        } finally { visiting.delete(value); }
    }
    const root = lower(value);
    if (!root || !transformed) return undefined;
    if (visit && domains.get(root)?.join() !== 'integer') return undefined;
    if (scan && (value.shape.length !== 1 || domains.get(root)?.join() !== 'integer')) return undefined;
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.tensorMapPreparations++;
    const host = { ...scope.host, valid: () => scope.host.valid?.() !== false && guards.every(guard => guard()) };
    const kernel = visit ? compileNativeTensorVisit(root, domains, host, scope.code, visit)
        : scan ? compileNativeIntegerScan(root, scan.seed, domains, host, scope.code)
        : operation === 'copy' ? compileNativeTensorCopy(root, domains, host, scope.code)
        : compileNativeTensorReduction(root, operation as TensorReduction, domains, host, scope.code);
    return range => {
        if (!consumerCompilation || !scope.enabled()) return undefined;
        const result = kernel.run(range);
        if (result !== undefined) scope.executed();
        return result;
    };
}

function mapScope(value: RankArray): PlanScope | undefined {
    for (let remaining = 1024; remaining > 0; remaining--) {
        const owner = owners.get(value);
        if (owner) return owner;
        const view = prepareNativeScalarView(value);
        if (!view) return undefined;
        value = view.source;
    }
    return undefined;
}
