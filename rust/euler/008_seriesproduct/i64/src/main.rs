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
const NUMBER: &str = "7316717653133062491922511967442657474235534919493496983520312774506326239578318016984801869478851843858615607891129494954595017379583319528532088055111254069874715852386305071569329096329522744304355766896648950445244523161731856403098711121722383113622298934233803081353362766142828064444866452387493035890729629049156044077239071381051585930796086670172427121883998797908792274921901699720888093776657273330010533678812202354218097512545405947522435258490771167055601360483958644670632441572215539753697817977846174064955149290862569321978468622482839722413756570560574902614079729686524145351004748216637048440319989000889524345065854122758866688116427171479924442928230863465674813919123162824586178664583591245665294765456828489128831426076900422421902267105562632111110937054421750694165896040807198403850962455444362981230987879927244284909188845801561660979191338754992005240636899125607176060588611646710940507754100225698315520005593572972571636269561882670428252483600823257530420752963450";

fn solve(limit: N) -> Result<N, String> {
    if limit <= n(0) { return Err("window sizes must be positive integers".into()); }
    let text = NUMBER.as_bytes();
    if limit > from_index(text.len()) { return Err("max requires at least one value".into()); }
    let width = index(&limit)?;
    let mut best = n(0);
    for window in text.windows(width) {
        let mut product = n(1);
        for digit in window { product = mul(&product, &n((digit - b'0') as i64)); }
        if product > best { best = product; }
    }
    Ok(best)
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let text = match args.as_slice() {
        [] => "13",
        [flag, value] if flag == "--width" => value,
        _ => return Err("usage: program [--width INTEGER]".into()),
    };
    let input = N::from_str(text).map_err(|_| "integer out of range or invalid")?;
    println!("{}", solve(input)?);
    Ok(())
}

fn main() {
    if let Err(error) = run() { eprintln!("{error}"); std::process::exit(1); }
}
