#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <unordered_map>
#include <vector>
// Independent oracle: factor every integer, then find the largest coefficient
// of the product (1 + x + ... + x^e), one factor for each prime exponent.
int main(int argc, char** argv) {
    const uint32_t limit = argc > 1 ? std::strtoul(argv[1], nullptr, 10) : 100000000;
    const auto start = std::chrono::steady_clock::now();
    std::vector<uint16_t> spf(limit / 2 + 1);
    for (uint32_t p = 3; uint64_t(p) * p <= limit; p += 2) {
        if (spf[p / 2]) continue;
        for (uint32_t m = p * p; m <= limit; m += 2 * p) if (!spf[m / 2]) spf[m / 2] = p;
    }
    std::unordered_map<uint64_t, uint32_t> widths;
    uint64_t answer = 0;
    for (uint32_t n = 1; n <= limit; n++) {
        uint32_t rest = n;
        int exponents[16], length = 0;
        if ((rest & 1) == 0) {
            int e = 0;
            do { rest /= 2; e++; } while ((rest & 1) == 0);
            exponents[length++] = e;
        }
        while (rest > 1) {
            const uint32_t p = spf[rest / 2] ? spf[rest / 2] : rest;
            int e = 0;
            do { rest /= p; e++; } while (rest % p == 0);
            exponents[length++] = e;
        }
        std::sort(exponents, exponents + length);
        uint64_t key = 0;
        for (int i = 0; i < length; i++) key = (key << 5) | exponents[i];
        auto found = widths.find(key);
        if (found == widths.end()) {
            std::vector<uint32_t> coefficients(1, 1);
            for (int i = 0; i < length; i++) {
                std::vector<uint32_t> next(coefficients.size() + exponents[i]);
                for (size_t j = 0; j < coefficients.size(); j++)
                    for (int e = 0; e <= exponents[i]; e++) next[j + e] += coefficients[j];
                coefficients = std::move(next);
            }
            found = widths.emplace(key, *std::max_element(coefficients.begin(), coefficients.end())).first;
        }
        answer += found->second;
    }
    std::cout << "{\"limit\":" << limit << ",\"answer\":\"" << answer << "\",\"ms\":"
              << std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count() << "}\n";
}
