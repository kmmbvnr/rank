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
    if limit < n(3) { return Err("empty candidate selection".into()); }
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
    best.ok_or("max requires at least one value".into())
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let text = match args.as_slice() {
        [] => "1000",
        [flag, value] if flag == "--target" => value,
        _ => return Err("usage: program [--target INTEGER]".into()),
    };
    let input = N::from_str(text).map_err(|_| "integer out of range or invalid")?;
    println!("{}", solve(input)?);
    Ok(())
}

fn main() {
    if let Err(error) = run() { eprintln!("{error}"); std::process::exit(1); }
}
