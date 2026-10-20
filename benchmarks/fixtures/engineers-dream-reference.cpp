// Independent segmented Eratosthenes search; no Rank runtime or residue wheel.
// clang++ -O3 -std=c++17 engineers-dream-reference.cpp -o /tmp/engineers-reference
// Optional upper bound permits checking small empty search windows.
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <vector>

bool practical(uint64_t n, const std::vector<int>& primes) {
    uint64_t sigma = 1;
    for (uint64_t p : primes) {
        if (p * p > n) break;
        if (n % p) continue;
        if (p > sigma + 1) return false;
        uint64_t power = 1, sum = 1;
        do { n /= p; power *= p; sum += power; } while (n % p == 0);
        sigma *= sum;
    }
    return n <= sigma + 1;
}

int main(int argc, char** argv) {
    const int64_t limit = argc > 1 ? std::atoll(argv[1]) : 1200000000;
    if (limit < 20 || limit > 1200000000) return 1;
    std::vector<bool> composite(40000);
    std::vector<int> primes;
    for (int p = 2; p < 40000; ++p) {
        if (composite[p]) continue;
        primes.push_back(p);
        for (int n = p * p; n < 40000; n += p) composite[n] = true;
    }
    const int64_t block = 1 << 20;
    int found = 0;
    int64_t answer = 0;
    for (int64_t base = 20; base <= limit; base += block) {
        const int64_t end = std::min(base + block - 2, limit);
        const int64_t first = base - 9, last = end + 9;
        std::vector<bool> marked(last - first + 1);
        for (int64_t p : primes) {
            if (p * p > last) break;
            for (int64_t n = std::max(p * p, (first + p - 1) / p * p); n <= last; n += p)
                marked[n - first] = true;
        }
        auto prime = [&](int64_t n) { return n >= 2 && !marked[n - first]; };
        for (int64_t n = base; n <= end; n += 2) {
            if (!prime(n - 9) || !prime(n - 3) || !prime(n + 3) || !prime(n + 9)) continue;
            bool ok = true;
            for (int d : {-7, -5, -1, 1, 5, 7}) if (prime(n + d)) ok = false;
            if (!ok) continue;
            for (int d : {-8, -4, 0, 4, 8}) if (!practical(n + d, primes)) { ok = false; break; }
            if (!ok) continue;
            std::cout << "paradise " << n << '\n';
            answer += n;
            if (++found == 4) { std::cout << "sum " << answer << '\n'; return 0; }
        }
    }
    std::cout << "found " << found << " sum " << answer << '\n';
}
