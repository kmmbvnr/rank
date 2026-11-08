// Independent depth-first powerful-number search. No sorted power table,
// ragged expansion, query windows or shared Rank arithmetic kernels.
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>
using wide = __uint128_t;
uint64_t root(uint64_t n) {
    uint64_t r = std::sqrt(static_cast<long double>(n));
    while (wide(r + 1) * (r + 1) <= n) r++;
    while (wide(r) * r > n) r--;
    return r;
}
std::string text(wide value) {
    if (!value) return "0";
    std::string out;
    while (value) { out.insert(out.begin(), char('0' + value % 10)); value /= 10; }
    return out;
}
std::vector<uint32_t> primes;
uint64_t states = 0, terms = 0;
wide visit(uint64_t limit, size_t first, uint64_t weight) {
    states++;
    wide total = 0;
    for (size_t i = first; i < primes.size(); i++) {
        const uint64_t p = primes[i];
        if (p * p > limit) break;
        uint64_t power = p * p, previous = 1;
        for (uint64_t exponent = 2;; exponent++) {
            const uint64_t current = exponent % p == 0 ? power : power / p;
            const uint64_t coefficient = current - previous;
            const uint64_t rest = limit / power;
            if (coefficient) {
                terms++;
                const uint64_t next = weight * coefficient;
                total += wide(next) * rest;
                if (i + 1 < primes.size() && uint64_t(primes[i + 1]) * primes[i + 1] <= rest)
                    total += visit(rest, i + 1, next);
            }
            previous = current;
            if (power > limit / p) break;
            power *= p;
        }
    }
    return total;
}
int main(int argc, char** argv) {
    const uint64_t limit = argc > 1 ? std::strtoull(argv[1], nullptr, 10) : 5000000000000000ULL;
    const uint64_t bound = root(limit);
    std::vector<bool> composite(bound + 1);
    for (uint64_t p = 2; p <= bound; p++) {
        if (composite[p]) continue;
        primes.push_back(p);
        if (p <= bound / p) for (uint64_t n = p * p; n <= bound; n += p) composite[n] = true;
    }
    const wide answer = (limit ? limit - 1 : 0) + visit(limit, 0, 1);
    std::cout << "{\"limit\":\"" << limit << "\",\"answer\":\"" << text(answer)
        << "\",\"states\":" << states << ",\"terms\":" << terms << "}\n";
}
