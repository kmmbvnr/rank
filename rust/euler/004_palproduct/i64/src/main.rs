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
    if limit < n(1) { return Err("digits must be positive".into()); }
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
    if best == n(0) { Err("max requires at least one value".into()) } else { Ok(best) }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let text = match args.as_slice() {
        [] => "3",
        [flag, value] if flag == "--digits" => value,
        _ => return Err("usage: program [--digits INTEGER]".into()),
    };
    let input = N::from_str(text).map_err(|_| "integer out of range or invalid")?;
    println!("{}", solve(input)?);
    Ok(())
}

fn main() {
    if let Err(error) = run() { eprintln!("{error}"); std::process::exit(1); }
}
