"""Independent small-grid oracle: enumerate local matchings and join arc components.

This does not use frontier states, encoded keys, or a DP count. Run from repo root.
"""
import itertools
import json
import subprocess
import sys


def matchings(items):
    if not items:
        yield []
        return
    for j in range(1, len(items), 2):
        for left in matchings(items[1:j]):
            for right in matchings(items[j + 1:]):
                yield [(items[0], items[j])] + left + right


def oracle(m, n):
    # The tangent order and arc identifiers describe the geometric input only.
    dx = [0, -1, 0, -1, -1, 0, -1, 0]
    dy = [-1, 0, 0, -1, 0, -1, -1, 0]
    arc = [2, 1, 3, 2, 0, 3, 1, 0]
    choices = []
    for y in range(n + 1):
        for x in range(m + 1):
            ends = [(cx * n + cy) * 4 + a
                    for sx, sy, a in zip(dx, dy, arc)
                    if 0 <= (cx := x + sx) < m and 0 <= (cy := y + sy) < n]
            choices.append(list(matchings(ends)))
    total = 0
    for local in itertools.product(*choices):
        parent = list(range(m * n * 4))

        def root(a):
            while parent[a] != a:
                a = parent[a]
            return a

        for pairs in local:
            for a, b in pairs:
                parent[root(a)] = root(b)
        if all(root(i) == root(0) for i in range(len(parent))):
            total += 1
    return str(total)


results = []
for m, n in [(1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (2, 1), (2, 2), (2, 3), (3, 2)]:
    expected = oracle(m, n)
    for variant in (sys.argv[1:] or ['original', 'hash', 'prune', 'hashprune']):
        for mode in ['reference', 'compiled']:
            proc = subprocess.run(['node', 'benchmarks/euler289-investigation.mjs', mode,
                                   str(m), str(n), variant], capture_output=True,
                                  text=True, check=True, timeout=30)
            result = json.loads(proc.stdout)
            assert result['answer'] == expected, (m, n, variant, mode, expected, result)
            results.append(result)
    print(json.dumps({'m': m, 'n': n, 'oracle': expected}), flush=True)
print(json.dumps({'comparisons': len(results), 'results': results}))
