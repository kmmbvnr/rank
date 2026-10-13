import itertools
import json
import math
import platform
import sys
import time


def by_permutations(n):
    result = []
    for q in itertools.permutations(range(n)):
        if len({col + i for i, col in enumerate(q)}) != n:
            continue
        if len({col - i for i, col in enumerate(q)}) == n:
            result.append(list(q))
    return result


def by_prefixes(n):
    states = [[0] * n]
    for row in range(n):
        dy = [row - i for i in range(row)]
        indices = []
        for parent, state in enumerate(states):
            q = state[:row]
            blocked = set(q + [col + d for col, d in zip(q, dy)]
                          + [col - d for col, d in zip(q, dy)])
            indices.extend(parent * n + col for col in range(n) if col not in blocked)
        if not indices:
            return []
        states = [states[index // n][:] for index in indices]
        for state, index in zip(states, indices):
            state[row] = index % n
    return states


name = sys.argv[1]
assert name in ("permutations", "prefixes")
solve = by_permutations if name == "permutations" else by_prefixes
start = time.perf_counter()
warm = solve(8)
warm_ms = (time.perf_counter() - start) * 1000
iterations = min(1000, max(1, math.ceil(200 / max(warm_ms, 0.1))))
checksum = 0
start = time.perf_counter()
for _ in range(iterations):
    solutions = solve(8)
    checksum += len(solutions)
ms = (time.perf_counter() - start) * 1000 / iterations
assert checksum == 92 * iterations
assert solutions == warm
print(json.dumps(dict(ms=ms, iterations=iterations, checksum=checksum,
                      solutions=solutions, version=platform.python_version())))
