# Euler 326: follow-up investigation

`326_modulosums.ra` now uses the row formula and one weighted histogram.
The investigation rechecked earlier prototypes after the Euler 328
reference-context changes. The interpreter and compiler are unchanged.

For prefix length 6t+r, r=0..5, the exact sum is
`9t² + B[r]t + C[r]`, with B=[-1,3,6,7,13,14] and C=[0,1,2,2,5,5].
Shifting t by M changes this by a multiple of M, giving a 6M residue
period. For each position in one period, the histogram adds N//(6M),
plus one if the position is at most N mod (6M). This counts all N+1
prefixes, including the initial zero. Equal-residue pairs give the answer.

The original recurrence already compiles. Full-input diagnostics report
three Number overflows and a mixed-integer loop. The row-formula prototype
avoids the large recurrence accumulator and stores one weighted histogram
instead of separate period and remainder histograms. One overflow remains
in the exact final answer reduction; integer accuracy is preserved.

Full input: N=10^12, M=10^6. Every run returned 1966666166408794329.
Times include parsing and execution. RSS is peak process RSS.

| Host / engine | Original seconds | Row formula seconds | Original MiB | Row formula MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled, median of 3 | 2.382 | 0.183 | 325.5 | 184.1 |
| Mac reference, median of 3 | 9.014 | 7.607 | 183.2 | 180.2 |
| Intel compiled, single control | 5.324 | 0.549 | 275.5 | 171.9 |
| Intel reference, single control | 24.730 | 16.917 | 171.0 | 169.8 |

Mac reference formula samples ranged from 5.222 to 7.684 seconds, so the
speed ratio is noisy. Both hosts used Node 24.15.0. The final Intel control
resolved the copied current language output alongside the interpreter;
an exploratory series that resolved an older language package was excluded.

Array alternatives were rechecked as single full-input Mac reference
controls: weighted `.accumulate` took 1.924 seconds / 462.3 MiB, while
32768-cell batches took 1.389 seconds / 373.2 MiB. These remain a speed /
memory tradeoff rather than a replacement with uniformly better behavior.

Verification repeated:

- Exact polynomial induction identities and period proof.
- Independent check of all six million terms and prefix sums.
- 279 executions over 93 cases in compiled, exact-loop and reference modes,
  including period boundaries and N up to 10^30; zero failures.
- 208 tests passed across `euler-326.test.ts`, `euler-328.test.ts` and
  `explicit-plan-demos.test.ts` via the audit-config runner. Coverage includes
  the production full answer and modulus-one counts beyond Number precision.
  No full suite or exhaustive audit was run.

The production implementation improves both engines and architectures while
reducing compiled RSS and retaining reference RSS. A general follow-up is
fusing integer index producers into
scatter-add consumers so that array syntax can retain its reference speed
without materializing key buffers. This is an unimplemented opportunity;
the current keyed-fold raw fast path accepts Int32 operands, and the
polynomial intermediates exceed that range. It must preserve exact overflow,
ordinary binding boundaries and error timing.

Reproduce the independent checks from the repository root:

```sh
python3 benchmarks/experiments/euler326-formula-proof.py
node benchmarks/experiments/euler326-oracle.mjs
node benchmarks/experiments/euler326-verify.mjs
```

Fresh raw measurements are in `baselines/2026-11-02-euler326-refresh.json`.
