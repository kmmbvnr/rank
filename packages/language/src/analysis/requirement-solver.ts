import type { AstNode } from 'langium';

/** Evidence in this module is a requirement, never an optimization proof. */
export interface RequirementSite {
    readonly node: AstNode;
    readonly reason: string;
}
export interface RequirementInterval {
    readonly min: number;
    readonly max: number;
    readonly lower?: RequirementSite;
    readonly upper?: RequirementSite;
    /** Equal dimension variables share a group; their actual lengths minus offset must match. */
    readonly equality?: { readonly group: number; readonly offset: number };
}
export interface RequirementConflict {
    readonly kind: 'rank' | 'dimension' | 'domain';
    readonly first: RequirementSite;
    readonly second: RequirementSite;
}
interface Variable { kind: 'rank' | 'dimension'; }
type Constraint =
    | { kind: 'bound'; variable: number; min: number; max: number; site: RequirementSite }
    | { kind: 'equal'; left: number; right: number; offset: number; site: RequirementSite }
    | { kind: 'frame'; source: number; frame: number; cell: number; site: RequirementSite }
    | { kind: 'sum'; result: number; left: number; right: number; site: RequirementSite };

/** Rank/dimension equalities share a weighted union-find; only frame arithmetic
 * needs a worklist. Function templates copy constraints, never solved call facts. */
export class RequirementSolver {
    readonly variables: Variable[] = [];
    readonly constraints: Constraint[] = [];
    variable(kind: Variable['kind'] = 'rank'): number {
        this.variables.push({ kind });
        return this.variables.length - 1;
    }
    bound(variable: number, min: number, max: number, site: RequirementSite): void {
        this.constraints.push({ kind: 'bound', variable, min, max, site });
    }
    equal(left: number, right: number, site: RequirementSite, offset = 0): void {
        this.constraints.push({ kind: 'equal', left, right, offset, site });
    }
    frame(source: number, frame: number, cell: number, site: RequirementSite): void {
        this.constraints.push({ kind: 'frame', source, frame, cell, site });
    }
    sum(result: number, left: number, right: number, site: RequirementSite): void {
        this.constraints.push({ kind: 'sum', result, left, right, site });
    }
    copy(template: RequirementSolver): (variable: number) => number {
        const offset = this.variables.length;
        this.variables.push(...template.variables);
        for (const item of template.constraints) {
            if (item.kind === 'bound') this.constraints.push({ ...item, variable: item.variable + offset });
            else if (item.kind === 'equal') this.constraints.push({ ...item, left: item.left + offset, right: item.right + offset });
            else if (item.kind === 'frame') this.constraints.push({ ...item, source: item.source + offset, frame: item.frame + offset });
            else this.constraints.push({ ...item, result: item.result + offset, left: item.left + offset, right: item.right + offset });
        }
        return variable => variable + offset;
    }
    solve(): { intervals: readonly RequirementInterval[]; conflicts: readonly RequirementConflict[]; limited: boolean } {
        const parents = this.variables.map((_, i) => i);
        const sizes = parents.map(() => 1);
        const offsets = parents.map(() => 0);
        const equalitySites: (RequirementSite | undefined)[] = parents.map(() => undefined);
        const conflicts: RequirementConflict[] = [];
        const find = (id: number): number => {
            if (parents[id] === id) return id;
            const old = parents[id];
            parents[id] = find(old);
            offsets[id] += offsets[old];
            return parents[id];
        };
        for (const constraint of this.constraints) {
            if (constraint.kind !== 'equal') continue;
            const { left, right, offset, site } = constraint;
            const a = find(left), b = find(right);
            const delta = offsets[right] + offset - offsets[left];
            if (a === b) {
                if (delta !== 0) conflicts.push({ kind: this.variables[left].kind, first: equalitySites[a] ?? site, second: site });
                continue;
            }
            if (sizes[a] <= sizes[b]) {
                parents[a] = b; offsets[a] = delta; sizes[b] += sizes[a]; equalitySites[b] ??= site;
            } else {
                parents[b] = a; offsets[b] = -delta; sizes[a] += sizes[b]; equalitySites[a] ??= site;
            }
        }
        parents.forEach((_, i) => find(i));
        const ranges: { min: number; max: number; lower?: RequirementSite; upper?: RequirementSite }[] = parents.map(() => ({ min: -Infinity, max: Infinity }));
        const dependents = parents.map(() => new Set<number>());
        const work: number[] = [];
        const queued = new Set<number>();
        const enqueue = (id: number) => { if (!queued.has(id)) { queued.add(id); work.push(id); } };
        const tighten = (id: number, min: number, max: number, lower?: RequirementSite, upper = lower) => {
            const root = parents[id], range = ranges[root], offset = offsets[id];
            if (range.min > range.max) return;
            let changed = false;
            if (min - offset > range.min) { range.min = min - offset; range.lower = lower; changed = true; }
            if (max - offset < range.max) { range.max = max - offset; range.upper = upper; changed = true; }
            if (range.min > range.max && range.lower && range.upper) {
                conflicts.push({ kind: this.variables[id].kind, first: range.lower, second: range.upper });
            }
            if (changed) dependents[root].forEach(enqueue);
        };
        const interval = (id: number): RequirementInterval => {
            const range = ranges[parents[id]], offset = offsets[id];
            return { ...range, min: range.min + offset, max: range.max + offset,
                ...(this.variables[id].kind === 'dimension'
                    ? { equality: { group: parents[id], offset } } : {}) };
        };
        this.constraints.forEach((item, i) => {
            const ids = item.kind === 'frame' ? [item.source, item.frame]
                : item.kind === 'sum' ? [item.result, item.left, item.right] : [];
            for (const id of ids) dependents[parents[id]].add(i);
            if (ids.length) enqueue(i);
        });
        parents.forEach((_, i) => tighten(i, 0, Infinity));
        for (const item of this.constraints) if (item.kind === 'bound') tighten(item.variable, item.min, item.max, item.site);
        // Malformed recursive shape equations must not monopolize an editor turn.
        // Stopping loses precision only: every bound already derived is necessary.
        const budget = Math.max(1000, 16 * (parents.length + this.constraints.length));
        let cursor = 0;
        while (cursor < work.length && cursor < budget) {
            const index = work[cursor++]; queued.delete(index);
            const item = this.constraints[index];
            if (item.kind === 'frame') {
                const a = interval(item.source), b = interval(item.frame);
                if (a.min > a.max || b.min > b.max) continue;
                const f = (rank: number) => item.cell >= 0 ? Math.max(0, rank - item.cell) : Math.min(rank, -item.cell);
                tighten(item.frame, f(a.min), f(a.max), a.lower ?? item.site, a.upper ?? item.site);
                if (item.cell >= 0) {
                    tighten(item.source, b.min > 0 ? b.min + item.cell : 0, b.max + item.cell,
                        b.lower ?? item.site, b.upper ?? item.site);
                } else {
                    tighten(item.source, b.min, b.max < -item.cell ? b.max : Infinity,
                        b.lower ?? item.site, b.upper ?? item.site);
                }
            } else if (item.kind === 'sum') {
                const a = interval(item.left), b = interval(item.right), r = interval(item.result);
                if ([a, b, r].some(value => value.min > value.max)) continue;
                tighten(item.result, a.min + b.min, a.max + b.max, a.lower ?? b.lower ?? item.site, a.upper ?? b.upper ?? item.site);
                if (item.left === item.right) {
                    tighten(item.left, Math.ceil(r.min / 2), Math.floor(r.max / 2), r.lower ?? item.site, r.upper ?? item.site);
                }
                tighten(item.left, Math.max(0, r.min - b.max), r.max - b.min, r.lower ?? item.site, r.upper ?? item.site);
                tighten(item.right, Math.max(0, r.min - a.max), r.max - a.min, r.lower ?? item.site, r.upper ?? item.site);
            }
        }
        return { intervals: parents.map((_, i) => interval(i)), conflicts, limited: cursor < work.length };
    }
}
