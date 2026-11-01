"""Scalar DIF and NumPy controls; fresh roots and fully computed output."""
import json
import math
import statistics
import sys
import time


def fft(samples):
    n = len(samples)
    r, im = list(samples), [0.0] * n
    c, s = [0.0] * (n // 2), [0.0] * (n // 2)
    for k in range(n // 2):
        angle = -2 * math.pi * k / n
        c[k], s[k] = math.cos(angle), math.sin(angle)
    size = n
    while size > 1:
        half, stride = size // 2, n // size
        for start in range(0, n, size):
            w = 0
            for k in range(half):
                lo, hi = start + k, start + k + half
                ur, ui, vr, vi = r[lo], im[lo], r[hi], im[hi]
                r[lo], im[lo] = ur + vr, ui + vi
                dr, di = ur - vr, ui - vi
                r[hi], im[hi] = dr * c[w] - di * s[w], dr * s[w] + di * c[w]
                w += stride
        size //= 2
    out_r, out_i, reversed_ = [0.0] * n, [0.0] * n, 0
    for i in range(n):
        out_r[i], out_i[i] = r[reversed_], im[reversed_]
        bit = n >> 1
        while reversed_ & bit:
            reversed_ ^= bit
            bit >>= 1
        reversed_ ^= bit
    return out_r, out_i


mode, n = sys.argv[1], int(sys.argv[2])
meta = {"python": sys.version, "mode": mode}
fn = fft
if mode.startswith("numpy"):
    import numpy as np
    meta["numpy"] = np.__version__
    if mode == "numpy-public":
        def fn(samples):
            result = np.fft.fft(np.asarray(samples, dtype=np.float64))
            return result.real.tolist(), result.imag.tolist()
    else:
        assert mode == "numpy-native"
        fn = np.fft.fft


def observed(result):
    if mode == "numpy-native":
        return result.real, result.imag
    return result


def argument(samples):
    return np.asarray(samples, dtype=np.float64) if mode == "numpy-native" else samples


def check(actual, expected):
    actual = observed(actual)
    assert len(actual) == 2 and all(len(row) == len(expected[0]) for row in actual)
    for p in range(2):
        for a, b in zip(actual[p], expected[p]):
            assert abs(a - b) < 1e-8 * max(1, abs(b)), (p, a, b)


for count in [2, 4, 8, 16, 32]:
    small = [math.sin(i * 1.71) + math.cos(i * .37) for i in range(count)]
    expected = [[sum(v * trig(-2 * math.pi * k * j / count) for j, v in enumerate(small))
                 for k in range(count)] for trig in [math.cos, math.sin]]
    check(fn(argument(small)), expected)
samples = argument([math.sin(2 * math.pi * 17 * j / n) + .3 * math.cos(2 * math.pi * 41 * j / n) for j in range(n)])
expected = [[.15 * n if k in [41, n - 41] else 0 for k in range(n)],
            [-n / 2 if k == 17 else n / 2 if k == n - 17 else 0 for k in range(n)]]
check(fn(samples), expected)
if len(sys.argv) > 3 and sys.argv[3] == "validate":
    print(json.dumps({**meta, "valid": True}))
    sys.exit(0)
start = time.perf_counter()
while time.perf_counter() - start < 1.5:
    fn(samples)
measured = []
for _ in range(3):
    cpu, start, calls = time.process_time(), time.perf_counter(), 0
    while True:
        result = fn(samples)
        calls += 1
        if time.perf_counter() - start >= .75:
            break
    elapsed, used = time.perf_counter() - start, time.process_time() - cpu
    check(result, expected)
    measured.append({"iterations": calls, "warmMs": 1000 * elapsed / calls, "cpuMs": 1000 * used / calls})
print(json.dumps({**meta, "n": n, "warmMs": statistics.median(row["warmMs"] for row in measured),
                  "cpuMs": statistics.median(row["cpuMs"] for row in measured), "measured": measured}))
