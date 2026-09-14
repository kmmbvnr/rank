#![allow(dead_code)]
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

type N = i64;

fn solve(limit: N) -> Result<N, String> {
    if limit <= n(2) { return Ok(n(0)); }
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
    Ok(sum)
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let text = match args.as_slice() {
        [] => "2000000",
        [flag, value] if flag == "--limit" => value,
        _ => return Err("usage: program [--limit INTEGER]".into()),
    };
    let input = N::from_str(text).map_err(|_| "integer out of range or invalid")?;
    println!("{}", solve(input)?);
    Ok(())
}

fn main() {
    if let Err(error) = run() { eprintln!("{error}"); std::process::exit(1); }
}
