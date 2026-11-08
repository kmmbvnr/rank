// Independent scalar check for moderate limits (e.g. 10^11).
// c++ -O3 -std=c++17 euler526-oracle.cpp -o /tmp/euler526-oracle
// /tmp/euler526-oracle 100000000000 99994514441
// The optional witness seeds only a verified lower bound, never the answer.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <numeric>
#include <vector>

using Integer = uint64_t;
using Wide = __uint128_t;
std::vector<Integer> primes;

Integer multiply(Integer a, Integer b, Integer modulus) {
    return Wide(a) * b % modulus;
}
Integer power(Integer a, Integer exponent, Integer modulus) {
    Integer result = 1;
    for (; exponent; exponent >>= 1, a = multiply(a, a, modulus)) {
        if (exponent & 1) result = multiply(result, a, modulus);
    }
    return result;
}
bool prime(Integer n) {
    if (n < 2) return false;
    for (Integer p : primes) {
        if (p > 1000) break;
        if (n % p == 0) return n == p;
    }
    Integer odd = n - 1, twos = 0;
    while (!(odd & 1)) odd >>= 1, twos++;
    for (Integer base : {2ULL, 325ULL, 9375ULL, 28178ULL, 450775ULL,
                         9780504ULL, 1795265022ULL}) {
        if (base % n == 0) continue;
        Integer value = power(base % n, odd, n);
        if (value == 1 || value == n - 1) continue;
        bool passed = false;
        for (Integer j = 1; j < twos; j++) {
            value = multiply(value, value, n);
            if (value == n - 1) { passed = true; break; }
        }
        if (!passed) return false;
    }
    return true;
}
Integer largest(Integer n) {
    Integer result = 1;
    for (Integer p : primes) {
        if (p > n / p) break;
        while (n % p == 0) { result = p; n /= p; }
    }
    return std::max(result, n);
}
Integer score(Integer n) {
    Integer result = 0;
    for (Integer j = 0; j < 9; j++) result += largest(n + j);
    return result;
}
int main(int argc, char** argv) {
    const Integer limit = argc > 1 ? std::stoull(argv[1]) : 100000000000ULL;
    const Integer witness = argc > 2 ? std::stoull(argv[2]) : 0;
    const Integer root = std::sqrt(limit + 8);
    std::vector<bool> marked(root + 1);
    for (Integer p = 2; p <= root; p++) {
        if (marked[p]) continue;
        primes.push_back(p);
        for (Integer q = p * p; q <= root; q += p) marked[q] = true;
    }
    const Integer modulus = 720720;
    const auto bound = [&](Integer n, Integer weight) {
        return Integer(Wide(n + 8) * weight / modulus) + 117;
    };
    std::vector<std::pair<Integer, Integer>> rows;
    for (Integer row = 0; row < modulus; row++) {
        Integer weight = 0;
        for (Integer j = 0; j < 9; j++) weight += modulus / std::gcd(row + j, modulus);
        rows.push_back({weight, row});
    }
    std::sort(rows.rbegin(), rows.rend());
    Integer best = witness >= 2 && witness <= limit ? score(witness) : 0;
    Integer winner = witness, tested = 0, factored = 0;
    const auto start = std::chrono::steady_clock::now();
    for (auto [weight, row] : rows) {
        if (row > limit || bound(limit, weight) <= best) continue;
        Integer n = limit - (limit - row) % modulus;
        while (n >= 2 && bound(n, weight) > best) {
            tested++;
            bool possible = true;
            for (Integer j = 0; j < 9; j++) {
                const Integer divisor = std::gcd(row + j, modulus);
                const Integer cofactor = (n + j) / divisor;
                if (bound(n, weight) + 13 - (n + j) / (2 * divisor) <= best
                    && !prime(cofactor)) { possible = false; break; }
            }
            if (possible) {
                factored++;
                const Integer value = score(n);
                if (value > best) { best = value; winner = n; }
            }
            if (n < modulus) break;
            n -= modulus;
        }
    }
    const auto elapsed = std::chrono::steady_clock::now() - start;
    std::cout << "{\"limit\":\"" << limit << "\",\"answer\":\"" << best
        << "\",\"witness\":\"" << winner << "\",\"tested\":" << tested
        << ",\"factored\":" << factored << ",\"ms\":"
        << std::chrono::duration<double, std::milli>(elapsed).count() << "}\n";
}
