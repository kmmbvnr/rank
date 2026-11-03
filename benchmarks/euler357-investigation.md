# Euler 357 investigation

Investigated on 2026-11-03 against the clean runtime at
`6f35c88370738555c3943175e2eb69b17ec62b57`, separately from the shared
workspace's unrelated interpreter edits. Next unfinished ascending entry
in issue #447 was `euler/357_primegenerating.ra`.

Production now includes the odd-divisor pairing and a general checked
Number specialization for captured certified integer membership. The
implementation maps readers by name, guards Int32 parameters and complete
range bounds (including terminal increments), and retains exact replay for
wide values. Other captured operations remain rejected. Observable polling
and demand budgets retain exact execution.

## Delivery verification

- TypeScript build and Langium generation pass.
- 318 focused regression tests pass on each host, including 23 new tests for
  reader binding/replacement, compiled callers, range edges, private-write
  replay, wide-input backoff, real values, errors and execution controls.
- 58 independent oracle/production-fixture checks pass on each host.
- Full answer **1739023853137** agrees in both engines on Mac and Intel.
- Final compiled medians of three fresh processes: Mac **1.233 s / 182.7
  MiB**, Intel **3.241 s / 166.5 MiB**.
- On the final compiler, the frozen original program takes **1.366 s**
  (Mac median); the additional odd-pair rewrite gives the final 1.233 s.
- Final reference takes **46.824 s / 446.0 MiB** on Mac and **153.851 s /
  421.3 MiB** on Intel (single processes).
- No exhaustive audits were run; corpus execution lanes/budgets are unchanged.

The following sections preserve the initial research controls. The built-JS
prototype patch and its environment flags are historical experiments only;
production has no such flags or helper-specific assumptions.

## Results

Default Limit=100000000, answer **1739023853137** throughout.
Fresh serial processes, Node 24.15.0. Mac numbers are medians of three
processes per compiled variant, interleaved in a fixed order. Intel values
are single fresh processes, so they establish direction rather than stable
speedup estimates. Background machine workload was not controlled.
RSS is process peak, including imported runtime and parser.

| Variant | Mac seconds | Mac RSS MiB | Intel seconds | Intel RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Original, compiled | 3.815 | 181.1 | 10.431 | 165.1 |
| Odd divisor pairs, existing compiler | 2.301 | 181.6 | 6.179 | 166.9 |
| Original + experimental Number/Int32 compiler | 1.362 | 181.3 | 3.564 | 167.7 |
| Both experiments | 1.261 | 181.8 | 3.207 | 167.5 |

Full original reference took 70.297 s / 435.1 MiB; odd-pairs reference took
46.947 s / 450.5 MiB (single Mac processes). Reference memory does not
improve, and this difference needs repetition before attributing it to the
algorithm. The compiler experiment does not affect reference execution.

Manual JavaScript using the same DensePrimeSieve and divisor trial scan,
with Number arithmetic and reduced framework/dispatch overhead, took
0.408 s / 84.8 MiB on Mac and 1.305 s / 85.0 MiB on Intel. It prefilters
candidates in the outer loop and is a performance reference, not an exact
model of Rank observable execution or its safety checks. At full size it
visits 458462 candidates after primality prefilters and performs 278501506
divisor trials. Therefore reducing work also matters.

## Compiler finding

The original outer loop and `good` helper compile. Captured certified
sequence membership is already supported by the exact scalar compiler.
Generated `good` still converts each divisor counter to BigInt and performs
BigInt modulo/division. The CPU profile's largest self-time is in the
anonymous generated helper.

`compileScalarNumberKernel` rejects any `proof.dependencies`, including
this captured sieve. Simply allowing membership lowering and passing the
existing certified membership readers to Number code is insufficient:
that prototype took 6.497 s, worse than the existing BigInt implementation.
Removing arithmetic `safe` wrappers as an unsafe speed ceiling still took
6.440 s. Guard removal is neither useful here nor a proposed change.

A second experiment guards the integer parameter against Int32 bounds,
then explicitly narrows it and the loop divisor. This keeps Number safety
checks on arithmetic and produces the improvement in the table. This
suggests V8 integer representation feedback is material; generated machine
code was not inspected, so the exact lowering mechanism is not established.

The saved patch is deliberately **not production ready**. It operates on
built JS, removes the broad dependency rejection for research, assumes the
Euler helper's parameter/loop layout, and narrows loop values without a
general range proof. INT32_INPUT=1 selects that experiment. UNSAFE_CEILING=1
selects the rejected guard-removal control. Neither environment flag is
proposed as a public option.

A general implementation should:

- Admit only dependencies proven to be certified immutable/pure membership
  readers, with current binding and reader guards retained.
- Map membership readers explicitly rather than assume lowering order.
- Guard Int32 integer parameters and range endpoints/steps before narrowing;
  preserve wide integers with exact fallback, including safe replay rules.
- Preserve real arithmetic, negative values, error timing, interrupt and
  demand-budget behavior. Arbitrary host membership methods are not trusted.
- Cover multiple dependencies, changed bindings, unsafe integers, range
  overflow and positive/negative range edges in focused regression tests.

## Algorithm finding

After existing parity rejection, N is 2 mod 4. Every divisor is either odd
or twice an odd divisor. Scan odd D through sqrt(N), and whenever D divides
N check both D + N/D and 2D + N/(2D). For odd D dividing this N, both
quotients are exact integers. The cases D=1 and 2 are already handled by
candidate enumeration and the existing prefilter.

Coverage proof: every divisor pair has a member at most sqrt(N). If that
member is odd, it is scanned directly; if it is even, it equals 2D for an
odd D at most sqrt(N)/2 and is covered by the second test. Extra duplicate
pair tests are harmless. N=1 retains its explicit early return.

`experiments/euler357-odd-pairs.ra` is the compact candidate. It uses one
existing range loop with `by 2`, no extra sieve or divisor arrays.

Rejected alternatives (single exploratory Mac processes):

- Reuse Sieve as outer iterable: 15.984 s / 607.9 MiB. This loses the
  specialized prime-range loop and introduces substantial iteration overhead.
- Existing library `divisors`, materialize and test its array: 30.886 s /
  465.4 MiB compiled; reference 39.049 s / 453.8 MiB. More compact, but a
  large compiled regression. The library constructs and sorts all divisors
  before yielding, losing the original early rejection behavior.
- Outer P mod 4 prefilter alone: 3.740 s, not a compelling improvement over
  baseline without repeated comparison.

## Verification and reproduction

On each host, original and odd-pairs variants passed 56 checks against an
independent trial-divisor/primality oracle: 14 limits including 0,1,2,100,
210,1000,10000, in both engines. Repeating with the compiler prototype
passed another 56 checks on each host. Full default answers also agree for
all reported variants. These are workload checks, not proof of general
compiler correctness. No exhaustive audits were run.

```sh
RUNTIME=file:///path/to/clean/packages/interpreter/out/index.js \
  node benchmarks/euler357-investigation.mjs 100000000 compiled
RUNTIME=file:///path/to/clean/packages/interpreter/out/index.js \
  node benchmarks/euler357-investigation.mjs 100000000 compiled \
  benchmarks/experiments/euler357-odd-pairs.ra
RUNTIME=file:///path/to/clean/packages/interpreter/out/index.js \
  node benchmarks/euler357-verify.mjs
```

The experimental patch applies inside a copied interpreter package with
matching built output. Keep this copy separate from production. Set
RUNTIME to its out/index.js and INT32_INPUT=1 when using the runner.
Raw samples and exploratory controls are in
`baselines/2026-11-03-euler357-investigation.json`.
