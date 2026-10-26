# Amicable sieve array updates

Measured on Apple M5, Node v24.15.0. Baseline: `d49aecb7ca15287a5dd2f2b7cad2e5f9ee08c0b6`, exported into an isolated directory and compiled before measurement. Both runtimes execute identical benchmark sources; their hashes and every sample are in the linked JSONL files.

Run after compiling each checkout:

```sh
node benchmarks/amicable-sieves.mjs --root=/path/to/baseline --limit=100000
node benchmarks/amicable-sieves.mjs --limit=100000
```

Each case uses one interpreter, three warmups and seven measured executions (three measured executions at one million). Measurements include `execute`, parsing, allocation and the final sum, and exclude process startup and imports. Benchmark processes ran sequentially without concurrent test or profiling work. Baseline ran first at 10000 and 1000000; candidate ran first at 100000. These are warm execution measurements, not cold-launch or memory measurements. All answers were checked: 31626, 852810 and 25275024. Both members of a pair must be below the limit in these fixtures.

## Pair-divisor sieve

`pairArray` expresses each inner pass as `At' = D * K; Sums At += D + K`, followed by the square correction. `pairScalar` runs the same pair-divisor algorithm with an explicit inner loop. Both use the same array-based final pair selection and reduction.

| Limit | Array before, ms | Array after, ms | Array speedup | Explicit loops after, ms | Remaining array/loop ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10000 | 22.63 | 11.36 | 1.99x | 6.56 | 1.73x |
| 100000 | 227.22 | 59.68 | 3.81x | 43.31 | 1.38x |
| 1000000 | 2474.14 | 504.52 | 4.90x | 431.78 | 1.17x |

The array version is faster than before but has not caught the equivalent explicit loops. The gap shrinks with larger inputs.

## Prime-power sieve

`primeArray` updates all multiples of each prime power by multiplying the next geometric numerator and dividing the previous one. `primeScalar` is the direct PierrotLeFou version, which discovers primes from the sigma table and calculates the exponent for each multiple.

| Limit | Prime array before, ms | Prime array after, ms | Speedup | Prime scalar after, ms |
| --- | ---: | ---: | ---: | ---: |
| 10000 | 30.42 | 26.81 | 1.13x | 6.53 |
| 100000 | 241.79 | 190.53 | 1.27x | 50.76 |
| 1000000 | 2130.51 | 1920.96 | 1.11x | 460.83 |

The main improvement applies to the pair-divisor version. Prime-power array updates still have substantial interpreter overhead and general floor-division writes.

## Runtime changes

- Native integer `+`, `-` and scalar `*` preserve a proved arithmetic progression for array addressing. Changed source storage, readers and shapes invalidate the proof; zero strides remain repeated indices.
- Full selector and RHS consumption can use existing native tensor kernels. RHS snapshots retain compact integer buffers before writes.
- Completed integer arithmetic and compact bulk writes use exact Number arithmetic while their results fit int32. Unsafe inputs or results fall back to arbitrary-precision arithmetic. Widening after a written prefix does not replay that prefix.
- Finite ranges with int32 endpoints can fill compact storage directly, with cancellation checkpoints.

The changes preserve snapshot writes, repeated-index behavior, binding checks, copy-on-write, exact wide integers and opaque host polling. New regression cases cover these boundaries. Existing Euler sources were not changed. The pair-divisor alternative is saved as [021_amicable_sieve.ra](../demos/euler/021_amicable_sieve.ra), with checks for the default answer, square divisors and the requirement that both pair members are below the limit.

## Raw measurements

| Limit | Baseline | Candidate |
| --- | --- | --- |
| 10000 | [before](baselines/2026-10-26-amicable-before-10000.jsonl) | [after](baselines/2026-10-26-amicable-after-10000.jsonl) |
| 100000 | [before](baselines/2026-10-26-amicable-before-100000.jsonl) | [after](baselines/2026-10-26-amicable-after-100000.jsonl) |
| 1000000 | [before](baselines/2026-10-26-amicable-before-1000000.jsonl) | [after](baselines/2026-10-26-amicable-after-1000000.jsonl) |

## Verification

TypeScript build, semantic-boundary checks and application-form checks passed. Both existing Euler 21 checks and all three Euler 95 checks passed, including the default inputs. Focused arithmetic, addressing, aliasing, storage and cancellation tests passed.

The ordinary interpreter run covered 372 files: 8443 tests passed and three pre-existing failures remained. It excludes the separately scheduled type, differential and Nurikabe audits. Two Euler 21 tests call the absent `amicable_sum` helper, and the Euler 23 compiler test expects an undefined result and an older compilation shape. These expectations also fail on the isolated baseline. They were not changed by this optimization.
