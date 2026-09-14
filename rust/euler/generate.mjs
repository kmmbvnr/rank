// Reproduce the artifacts authored by the coding agent for Euler 1–10.
// These reviewed fixture implementations are not the npm compiler's backend.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {prepare} from '../../packages/compile/src/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('./', import.meta.url));
const fixtures = [
  ['001_multiples', 'limit', '1000', [-5, 0, 1, 3, 4, 5, 6, 10, 16, 31, 101, 997]],
  ['002_evenfib', 'limit', '4000000', [-1, 0, 1, 2, 7, 8, 9, 33, 34, 35, 100, '9223372036854775807']],
  ['003_primefactor', 'n', '600851475143', [2, 3, 4, 8, 49, 97, 13195], [0, 1, -1]],
  ['004_palproduct', 'digits', '3', [1, 2], [0, -1]],
  ['005_smallestmultiple', 'limit', '20', [-2, 0, 1, 2, 3, 10, 15, 30]],
  ['006_sumsquarediff', 'limit', '100', [-2, 0, 1, 2, 3, 10, 33, 1000]],
  ['007_10001stprime', 'count', '10001', [1, 2, 3, 6, 20, 100, 1000], [0, -1]],
  ['008_seriesproduct', 'width', '13', [1, 2, 4, 5, 12, 14, 20, 1000], [0, -1, 1001]],
  ['009_pythagorean', 'target', '1000', [12, 24, 30, 36, 40, 60, 120], [0, -1, 11, 13]],
  ['010_sumprimes', 'limit', '2000000', [-1, 0, 1, 2, 3, 4, 10, 11, 12, 100, 1000]],
];

const common = `#![allow(dead_code)]
use std::str::FromStr;
fn n(value: i64) -> N { value.into() }
fn add(a: &N, b: &N) -> N { a + b }
fn sub(a: &N, b: &N) -> N { a - b }
fn mul(a: &N, b: &N) -> N { a * b }
fn div(a: &N, b: &N) -> N { a / b }
fn rem(a: &N, b: &N) -> N { a % b }
fn from_index(value: usize) -> N { N::from_str(&value.to_string()).expect("integer out of range") }
fn index(value: &N) -> Result<usize, String> {
    value.to_string().parse().map_err(|_| "input exceeds machine indexing capacity".into())
}
fn gcd(mut a: N, mut b: N) -> N {
    while b != n(0) { let rest = rem(&a, &b); a = b; b = rest; }
    a
}
fn power10(count: usize) -> N {
    let mut value = n(1);
    for _ in 0..count { value = mul(&value, &n(10)); }
    value
}
fn triangle(k: N) -> N {
    // Divide an even factor first; avoid needless narrow intermediate overflow.
    let next = add(&k, &n(1));
    if rem(&k, &n(2)) == n(0) { mul(&div(&k, &n(2)), &next) }
    else { mul(&k, &div(&next, &n(2))) }
}
`;

const bodies = [
`    if limit <= n(1) { return Ok(n(0)); }
    let last = sub(&limit, &n(1));
    let multiples = |d: i64| mul(&n(d), &triangle(div(&last, &n(d))));
    Ok(sub(&add(&multiples(3), &multiples(5)), &multiples(15)))`,
`    let mut previous = n(0);
    let mut current = n(2);
    let mut sum = n(0);
    while current <= limit {
        sum = add(&sum, &current);
        // Test against the accepted bound before computing unused lookahead.
        if current > div(&sub(&limit, &previous), &n(4)) { break; }
        let next = add(&mul(&current, &n(4)), &previous);
        previous = current; current = next;
    }
    Ok(sum)`,
`    if limit < n(1) { return Err("factors expects a positive integer".into()); }
    if limit == n(1) { return Err("max requires at least one value".into()); }
    let mut rest = limit;
    let mut divisor = n(2);
    let mut largest = n(1);
    while divisor <= div(&rest, &divisor) {
        while rem(&rest, &divisor) == n(0) {
            largest = divisor.clone(); rest = div(&rest, &divisor);
        }
        divisor = add(&divisor, &n(if divisor == n(2) { 1 } else { 2 }));
    }
    Ok(if rest > n(1) { rest } else { largest })`,
`    if limit < n(1) { return Err("digits must be positive".into()); }
    let digits = index(&limit)?;
    let lower = power10(digits - 1);
    let upper = sub(&mul(&lower, &n(10)), &n(1));
    let mut best = n(0);
    let mut a = upper;
    while a >= lower {
        if mul(&a, &a) <= best { break; }
        let mut b = a.clone();
        while b >= lower {
            let product = mul(&a, &b);
            if product <= best { break; }
            let text = product.to_string();
            if text.bytes().eq(text.bytes().rev()) { best = product; break; }
            b = sub(&b, &n(1));
        }
        a = sub(&a, &n(1));
    }
    if best == n(0) { Err("max requires at least one value".into()) } else { Ok(best) }`,
`    let mut result = n(1);
    let mut i = n(1);
    while i <= limit {
        result = mul(&div(&result, &gcd(result.clone(), i.clone())), &i);
        i = add(&i, &n(1));
    }
    Ok(result)`,
`    if limit < n(1) { return Ok(n(0)); }
    let sum = triangle(limit.clone());
    let squares = div(&mul(&mul(&limit, &add(&limit, &n(1))), &add(&mul(&n(2), &limit), &n(1))), &n(6));
    Ok(sub(&mul(&sum, &sum), &squares))`,
`    if limit < n(1) { return Err("sequence index must be nonnegative".into()); }
    let count = index(&limit)?;
    let mut primes: Vec<usize> = Vec::new();
    let mut candidate: usize = 2;
    loop {
        let mut prime = true;
        for &p in &primes {
            if p > candidate / p { break; }
            if candidate % p == 0 { prime = false; break; }
        }
        if prime {
            primes.push(candidate);
            if primes.len() == count { return Ok(from_index(candidate)); }
        }
        candidate = candidate.checked_add(if candidate == 2 { 1 } else { 2 })
            .ok_or("prime exceeds machine indexing capacity")?;
    }`,
`    if limit <= n(0) { return Err("window sizes must be positive integers".into()); }
    let text = NUMBER.as_bytes();
    if limit > from_index(text.len()) { return Err("max requires at least one value".into()); }
    let width = index(&limit)?;
    let mut best = n(0);
    for window in text.windows(width) {
        let mut product = n(1);
        for digit in window { product = mul(&product, &n((digit - b'0') as i64)); }
        if product > best { best = product; }
    }
    Ok(best)`,
`    if limit < n(3) { return Err("empty candidate selection".into()); }
    let last_a = div(&sub(&limit, &n(1)), &n(3));
    let last_b = div(&sub(&limit, &n(1)), &n(2));
    let mut a = n(1);
    let mut best = None;
    while a <= last_a {
        let mut b = add(&a, &n(1));
        while b <= last_b {
            let c = sub(&sub(&limit, &a), &b);
            if b < c && add(&mul(&a, &a), &mul(&b, &b)) == mul(&c, &c) {
                let product = mul(&mul(&a, &b), &c);
                if best.as_ref().map_or(true, |old| &product > old) { best = Some(product); }
            }
            b = add(&b, &n(1));
        }
        a = add(&a, &n(1));
    }
    best.ok_or("max requires at least one value".into())`,
`    if limit <= n(2) { return Ok(n(0)); }
    let bound = index(&limit)?;
    let mut sieve = Vec::new();
    sieve.try_reserve_exact(bound).map_err(|_| "sieve exceeds allocation capacity")?;
    sieve.resize(bound, true);
    sieve[0] = false; sieve[1] = false;
    let mut p: usize = 2;
    while p <= (bound - 1) / p {
        if sieve[p] {
            let mut multiple = p * p;
            while multiple < bound {
                sieve[multiple] = false;
                let Some(next) = multiple.checked_add(p) else { break; };
                multiple = next;
            }
        }
        p += 1;
    }
    let mut sum = n(0);
    for (i, prime) in sieve.iter().enumerate() {
        if *prime { sum = add(&sum, &from_index(i)); }
    }
    Ok(sum)`,
];

await mkdir(here, {recursive: true});
for (const [i, [name, flag, defaultValue, values, errors = []]] of fixtures.entries()) {
  for (const integers of ['exact', 'i64']) {
    const directory = `${here}/${name}/${integers}`;
    const cases = [{name: 'default input', args: []},
      ...values.map(value => ({args: [`--${flag}`, String(value)]})),
      ...errors.map(value => ({args: [`--${flag}`, String(value)], error: true})),
      {args: [`--${flag}`, 'oops'], error: true}];
    if (i === 1 && integers === 'exact') cases.push({args: ['--limit', String(10n ** 100n)]});
    if (i === 4) cases.push({args: ['--limit', '50'], ...(integers === 'i64' ? {overflow: true} : {})});
    if (i === 5) cases.push({args: ['--limit', '100000'], ...(integers === 'i64' ? {overflow: true} : {})});
    const casesFile = `${here}/.cases-${name}-${integers}.json`;
    await writeFile(casesFile, JSON.stringify(cases, null, 2) + '\n');
    try {
      await prepare(`${root}/demos/euler/${name}.ra`, {out: directory, integers, casesFile});
    } finally {
      const {unlink} = await import('node:fs/promises');
      await unlink(casesFile);
    }
    const source = await readFile(`${root}/demos/euler/${name}.ra`, 'utf8');
    const literal = i === 7 ? `const NUMBER: &str = "${source.match(/^Number = "([0-9]+)"$/m)[1]}";\n` : '';
    const main = `${common}\n${integers === 'exact' ? 'type N = num_bigint::BigInt;' : 'type N = i64;'}\n${literal}
fn solve(limit: N) -> Result<N, String> {
${bodies[i]}
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let text = match args.as_slice() {
        [] => "${defaultValue}",
        [flag, value] if flag == "--${flag}" => value,
        _ => return Err("usage: program [--${flag} INTEGER]".into()),
    };
    let input = N::from_str(text).map_err(|_| "integer out of range or invalid")?;
    println!("{}", solve(input)?);
    Ok(())
}

fn main() {
    if let Err(error) = run() { eprintln!("{error}"); std::process::exit(1); }
}
`;
    await writeFile(`${directory}/src/main.rs`, main);
    console.log(`Generated ${name}/${integers}`);
  }
}
