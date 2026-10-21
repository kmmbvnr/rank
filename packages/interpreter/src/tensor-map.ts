import { matchCompiledOperatorDomains, tensorOperatorSignatures, type CompiledAtomType } from '@arrrank/language';
import { arrayCellValidator } from './derived-array.js';
import { checkpoint } from './interrupt.js';
import { prepareIdentityScalarView, prepareIntegerView, prepareStoredScalarView } from './integer-view.js';
import { compileNativeTensorReduction, type TensorCodeCache, type TensorKernelHost, type TensorNode, type TensorReduction } from './tensor-kernel.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

interface MapRecipe {
    readonly reader: RankArray['itemAt'];
    readonly shape: readonly number[];
    readonly operator: string;
    readonly operands: readonly RankValue[];
    readonly scope: PlanScope;
}
const maps = new WeakMap<RankArray, MapRecipe>();
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

export function constructingTensorPlan(): boolean { return active !== undefined; }

/** Only native scalar operators can publish a recipe. Host readers and callbacks
 * cannot acquire this capability by having a numeric result annotation. */
export function registerTensorMap<T extends RankValue>(value: T, operator: string, ...operands: RankValue[]): T {
    if (active?.enabled() && isRankArray(value) && mapOperators.has(operator)) {
        maps.set(value, { reader: value.itemAt, shape: [...value.shape], operator, operands, scope: active });
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
    let remaining = 1024;
    let mapped = false;
    const typed = <T extends TensorNode>(node: T, domain: readonly CompiledAtomType[]): T => { domains.set(node, domain); return node; };
    function check(source: TensorNode, validate: ((cell: RankValue, index: number) => RankValue) | undefined): TensorNode {
        return validate ? typed({ kind: 'check', source, validate }, domains.get(source)!) : source;
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
            const view = prepareIdentityScalarView(value);
            if (view) {
                const source = lower(view.source);
                return source && check(source, view.validate);
            }
            // Stored arrays are completion boundaries, even if their creation
            // had a recipe. Only their present storage may feed this demand.
            const stored = prepareStoredScalarView(value, true);
            if (stored?.kinds?.length === 0 && value.shape.some(n => n === 0)) {
                return typed({ kind: 'input', value }, ['integer', 'real', 'boolean']);
            }
            // Keep validation in graph order. A nonidentity checked view may
            // not establish a later operand's contract before an earlier fails.
            if (stored?.validate) return undefined;
            if (stored?.kinds?.length
                && stored.kinds.every((kind): kind is CompiledAtomType => kind === 'integer' || kind === 'real' || kind === 'boolean')) {
                return typed({ kind: 'input', value }, stored.kinds);
            }
            if (prepareIntegerView(value)) return typed({ kind: 'input', value }, ['integer']);
            const map = maps.get(value);
            if (!map || map.reader !== value.itemAt || map.shape.length !== value.shape.length
                || map.shape.some((n, axis) => n !== value.shape[axis])) return undefined;
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
            mapped = true;
            const node = typed(operands.length === 1 ? { kind: 'unary', op: map.operator, operand: operands[0]! }
                : { kind: 'binary', op: map.operator, left: operands[0]!, right: operands[1]! }, matched.result);
            const validate = arrayCellValidator(value);
            return check(node, validate && ((cell, index) => { validate(cell, index); return cell; }));
        } finally { visiting.delete(value); }
    }
    const root = lower(value);
    if (!root || !mapped) return undefined;
    const result = compileNativeTensorReduction(root, operation as TensorReduction, domains, scope.host, scope.code).run();
    if (result !== undefined) scope.executed();
    return result;
}

function mapScope(value: RankArray): PlanScope | undefined {
    for (let remaining = 1024; remaining > 0; remaining--) {
        const map = maps.get(value);
        if (map) return map.scope;
        const view = prepareIdentityScalarView(value);
        if (!view) return undefined;
        value = view.source;
    }
    return undefined;
}
