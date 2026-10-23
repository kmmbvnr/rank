// Independent native implementation of the original four-count formula.
// clang++ -O3 -std=c++17 benchmarks/euler397-oracle.cpp -o /tmp/euler397-oracle
// /tmp/euler397-oracle 1000000 1000000000
#include <algorithm>
#include <iostream>
#include <string>
#include <utility>
#include <vector>

using Integer = long long;
Integer bound;
__int128 hits[4]{};

Integer floorHalf(Integer n) {
    return n / 2 - (n < 0 && n % 2 != 0);
}

void overlap(Integer s, Integer t, Integer q, int at) {
    if ((s + t - q) % 2 != 0) return;
    const Integer a = (s + t - q) / 2;
    const Integer b = (s + q - t) / 2;
    const Integer c = (t + q - s) / 2;
    if (a >= -bound && a < b && b < c && c <= bound) hits[at]++;
}

void score(Integer d, Integer d0, Integer k) {
    const Integer u = d0 / d, s = k - u, t = d - k, range = 2 * bound;
    if (s >= -range && s <= range && t >= -range && t <= range) {
        const Integer lo = std::max(t - bound, -bound);
        const Integer hi = std::min({s + bound, bound, floorHalf(s - 1)});
        if (hi >= lo) hits[0] += hi - lo + 1;
        Integer den = s + k, q = k * (s - k);
        if (den != 0 && q % den == 0) overlap(s, t, q / den, 2);
        den = k - t;
        q = k * (k + t);
        if (den != 0 && q % den == 0) overlap(s, t, q / den, 3);
    }
    const Integer p = -(k + u), q = k + d;
    if (p >= -range && q <= range) {
        const Integer lo = std::max({p - bound, -bound, q - bound, floorHalf(p) + 1});
        const Integer hi = std::min({p + bound, bound, floorHalf(q - 1)});
        if (hi >= lo) hits[1] += hi - lo + 1;
    }
}

void divisors(const std::vector<std::pair<Integer, int>>& factors,
              std::size_t i, Integer d, Integer d0, Integer k) {
    if (i == factors.size()) { score(d, d0, k); return; }
    const auto [p, exponent] = factors[i];
    for (int e = 0; e <= exponent; e++) {
        divisors(factors, i + 1, d, d0, k);
        if (e < exponent) d *= p;
    }
}

std::string decimal(__int128 n) {
    if (n == 0) return "0";
    std::string result;
    while (n != 0) { result.push_back('0' + n % 10); n /= 10; }
    std::reverse(result.begin(), result.end());
    return result;
}

int main(int argc, char** argv) {
    if (argc != 3) return 1;
    const int limit = std::stoi(argv[1]);
    bound = std::stoll(argv[2]);
    if (limit < 0 || limit > 1000000 || bound < 0 || bound > 1000000000) return 1;
    std::vector<int> smallest(limit + 1);
    for (int p = 2; p <= limit; p++) if (smallest[p] == 0) {
        for (int n = p; n <= limit; n += p) if (smallest[n] == 0) smallest[n] = p;
    }
    for (Integer k = 1; k <= limit; k++) {
        std::vector<std::pair<Integer, int>> factors{{2, 1}};
        for (int remaining = k; remaining > 1;) {
            const int p = smallest[remaining];
            int exponent = 0;
            do { remaining /= p; exponent += 2; }
            while (remaining > 1 && smallest[remaining] == p);
            if (p == 2) factors[0].second += exponent;
            else factors.emplace_back(p, exponent);
        }
        divisors(factors, 0, 1, 2 * k * k, k);
    }
    std::cout << decimal(2 * hits[0] + hits[1] - 2 * hits[2] - hits[3]) << '\n';
}
