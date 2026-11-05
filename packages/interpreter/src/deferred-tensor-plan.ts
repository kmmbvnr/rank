import type { RankPlan } from './plan.js';
import type { RankValue } from './value.js';

// Only the interpreter's pure plan constructor can grant this capability.
// The public RankPlan.expression/evaluate fields are never speculative inputs.
const recipes = new WeakMap<RankPlan, () => RankValue | undefined>();
let suspended = false;
export function withoutDeferredTensorPlans<T>(run: () => T): T {
    const before = suspended; suspended = true;
    try { return run(); } finally { suspended = before; }
}
let active: { values: Map<RankPlan, RankValue | undefined>; visiting: Set<RankPlan>; remaining: number } | undefined;
export function registerDeferredTensorPlan(plan: RankPlan, prepare: () => RankValue | undefined): void {
    recipes.set(plan, prepare);
}
export function prepareDeferredTensorPlan(plan: RankPlan): RankValue | undefined {
    if (suspended) return undefined;
    const prepare = recipes.get(plan);
    if (!prepare) return undefined;
    const caller = active;
    const scope = active ??= { values: new Map(), visiting: new Set(), remaining: 1024 };
    try {
        if (scope.values.has(plan)) return scope.values.get(plan);
        if (--scope.remaining < 0 || scope.visiting.has(plan)) return undefined;
        scope.visiting.add(plan);
        try {
            const value = prepare();
            scope.values.set(plan, value);
            return value;
        } finally { scope.visiting.delete(plan); }
    } finally { active = caller; }
}
/** Binding checks retain their own demand, after constructing the native value. */
export function inheritDeferredTensorPlan(source: RankPlan, target: RankPlan, check: (value: RankValue) => RankValue): void {
    if (recipes.has(source)) recipes.set(target, () => {
        const value = prepareDeferredTensorPlan(source);
        return value === undefined ? undefined : check(value);
    });
}
