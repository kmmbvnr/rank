const pureFunctions = new WeakSet<Function>();

/** Trust a host implementation to return synchronously, without mutating inputs
 * or Rank state, re-entering Rank, or exposing observable side effects. It must
 * return the same value for the same inputs (fresh result allocations are fine).
 * Throwing errors is allowed. This is an author-supplied contract, not a check.
 * The guarantee belongs to this exact function; wrappers must declare it anew. */
export function pureHostFunction<Arguments extends unknown[], Result>(
    implementation: (...arguments_: Arguments) => Result,
): (...arguments_: Arguments) => Result {
    pureFunctions.add(implementation);
    return implementation;
}

export function isPureHostFunction(implementation: Function): boolean {
    return pureFunctions.has(implementation);
}
