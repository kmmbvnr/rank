import { sequence } from '../sequence.js';
import type { SequencePlan, SequencePredicate } from '../value.js';
import type { RuntimeModule } from './types.js';

interface Boundary {
    readonly limit: bigint;
    readonly inclusive: boolean;
}

export const sequencesModule: RuntimeModule = {
    fibonacci: () => sequence(fibonacciPlan()),
};

function fibonacciPlan(boundary?: Boundary, evenOnly = false): SequencePlan {
    return {
        name: evenOnly ? 'even fibonacci' : 'fibonacci',
        finite: boundary !== undefined,
        *iterate() {
            let current = evenOnly ? 2n : 1n;
            let next = evenOnly ? 8n : 2n;
            while (!boundary || within(current, boundary)) {
                yield current;
                [current, next] = evenOnly
                    ? [next, 4n * next + current]
                    : [next, current + next];
            }
        },
        withUpperBound(limit, inclusive) {
            return fibonacciPlan({ limit, inclusive }, evenOnly);
        },
        withFilter(predicate: SequencePredicate) {
            if (predicate.optimizationKey === 'even') return fibonacciPlan(boundary, true);
            return undefined;
        },
    };
}

function within(value: bigint, boundary: Boundary): boolean {
    return boundary.inclusive ? value <= boundary.limit : value < boundary.limit;
}
