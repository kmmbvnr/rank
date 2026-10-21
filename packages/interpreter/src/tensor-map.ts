import { matchCompiledOperatorDomains, tensorOperatorSignatures, type CompiledAtomType } from '@arrrank/language';
import { arrayCellValidator } from './derived-array.js';
import { checkpoint } from './interrupt.js';
import { prepareNativeScalarView, prepareIntegerView, prepareStoredScalarView } from './integer-view.js';
import { arrayRevision } from './array-revision.js';
import { compileNativeTensorReduction, type TensorCodeCache, type TensorKernelHost, type TensorNode, type TensorReduction } from './tensor-kernel.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

interface MapRecipe {
    readonly reader: RankArray['itemAt'];
    readonly shape: readonly number[];
    readonly operator: string;
    readonly layout: 'broadcast' | 'outer';
    readonly operands: readonly RankValue[];
}
const maps = new WeakMap<RankArray, MapRecipe>();
const owners = new WeakMap<RankArray, PlanScope>();
const mapOperators = new Set(['+', '-', '*', '/', '//', 'mod', '**',
    'less', 'greater', 'atmost', 'atleast', 'equal', 'notequal', 'and', 'or', 'xor', 'not']);
const reductions: ReadonlySet<string> = new Set<TensorReduction>(['sum', 'mean', 'min', 'max', 'count', 'any', 'all']);
interface PlanScope {
    readonly host: TensorKernelHost;
    readonly code: TensorCodeCache;
    enabled(): boolean;
    executed(): void;
}
let active: PlanScope | undefined;

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

/** Lower actual, checked native arrays after normal plan demand. Never inspect
 * RankPlan.expression or evaluate a producer to make a speculative guard pass. */
export function reduceTensorMap(value: RankArray, operation: string): RankValue | undefined {
    if (!reductions.has(operation)) return undefined;
    const scope = active ?? mapScope(value);
    if (!scope?.enabled()) return undefined;
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
            const matched = matchCompiledOperatorDomains(tensorOperatorSignatures(map.operator, operands.length),
                operands.map(node => domains.get(node)!));
            if (!matched) return undefined;
            transformed = true;
            const node = typed(operands.length === 1 ? { kind: 'unary', op: map.operator, operand: operands[0]! }
                : { kind: map.layout === 'outer' ? 'outer' : 'binary', op: map.operator, left: operands[0]!, right: operands[1]! }, matched.result);
            const validate = arrayCellValidator(value);
            return check(node, validate && ((cell, index) => { validate(cell, index); return cell; }));
        } finally { visiting.delete(value); }
    }
    const root = lower(value);
    if (!root || !transformed) return undefined;
    const host = { ...scope.host, valid: () => scope.host.valid?.() !== false && guards.every(guard => guard()) };
    const result = compileNativeTensorReduction(root, operation as TensorReduction, domains, host, scope.code).run();
    if (result !== undefined) scope.executed();
    return result;
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
