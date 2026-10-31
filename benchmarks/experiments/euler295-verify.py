"""Small oracle: explicitly union radius pairs, without inclusion-exclusion."""
import json
import math
import subprocess
from pathlib import Path

cases = []
for n in [0, 1, 2, 3, 5, 9, 10, 11, 20, 21, 30, 50, 75, 99, 100]:
    pairs, families = set(), set()
    for a in range(1, math.isqrt(6 * n) + 1, 2):
        for b in range(1, a + 1, 2):
            s = a * a + b * b
            if s > 6 * n or math.gcd(a, b) != 1:
                continue
            u = pow(a, -1, b) if b > 1 else 0
            v = (1 - a * u) // b
            m = (b * u - a * v) % s
            t = max(1, (m * (s - m) - 1 + s - 1) // s)
            if t % 2 == 0:
                t += 1
            families.add((s, t))
    for s, t in families:
        last = math.isqrt(max(0, 4 * n * n // s - 1))
        radii = [s * (1 + k * k) // 4 for k in range(t, last + 1, 2)]
        pairs.update((x, y) for i, x in enumerate(radii) for y in radii[i:])
    cases.append({"n": n, "answer": str(len(pairs))})

checks = []
for case in cases:
    for mode in ["compiled", "reference"]:
        for variant in ["original", "shipping", "vector"]:
            child = subprocess.run(["node", "benchmarks/euler295-investigation.mjs", mode,
                                    variant, str(case["n"])],
                                   text=True, capture_output=True, timeout=30, check=True)
            result = json.loads(child.stdout)
            assert result["answer"] == case["answer"], (case, mode, variant, result)
            checks.append({"n": case["n"], "mode": mode, "variant": variant,
                           "answer": result["answer"]})
Path("benchmarks/baselines/2026-10-31-euler295-verification.json").write_text(
    json.dumps({"oracle": "Explicit radius-pair union; same geometric family parametrization",
                "cases": cases, "checks": checks}, indent=2) + "\n")
print(f"Passed {len(checks)} executions against explicit pair unions")
