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

type N = num_bigint::BigInt;

fn solve(limit: N) -> Result<N, String> {
    if limit < n(1) { return Err("factors expects a positive integer".into()); }
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
    Ok(if rest > n(1) { rest } else { largest })
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let text = match args.as_slice() {
        [] => "600851475143",
        [flag, value] if flag == "--n" => value,
        _ => return Err("usage: program [--n INTEGER]".into()),
    };
    let input = N::from_str(text).map_err(|_| "integer out of range or invalid")?;
    println!("{}", solve(input)?);
    Ok(())
}

fn main() {
    if let Err(error) = run() { eprintln!("{error}"); std::process::exit(1); }
}
