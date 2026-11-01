# Scalar DIF control with fresh roots and a direct output permutation.
require 'json'

def fft(samples)
  n = samples.length
  r, im = samples.dup, Array.new(n, 0.0)
  c, s = Array.new(n / 2, 0.0), Array.new(n / 2, 0.0)
  k = 0
  while k < n / 2
    angle = -2 * Math::PI * k / n
    c[k], s[k] = Math.cos(angle), Math.sin(angle)
    k += 1
  end
  size = n
  while size > 1
    half, stride, start = size / 2, n / size, 0
    while start < n
      k, w = 0, 0
      while k < half
        lo, hi = start + k, start + k + half
        ur, ui, vr, vi = r[lo], im[lo], r[hi], im[hi]
        r[lo], im[lo] = ur + vr, ui + vi
        dr, di = ur - vr, ui - vi
        r[hi] = dr * c[w] - di * s[w]
        im[hi] = dr * s[w] + di * c[w]
        k += 1
        w += stride
      end
      start += size
    end
    size /= 2
  end
  out_r, out_i = Array.new(n, 0.0), Array.new(n, 0.0)
  reversed, i = 0, 0
  while i < n
    out_r[i], out_i[i] = r[reversed], im[reversed]
    bit = n >> 1
    while (reversed & bit) != 0
      reversed ^= bit
      bit >>= 1
    end
    reversed ^= bit
    i += 1
  end
  [out_r, out_i]
end

def check(actual, expected)
  raise 'shape' unless actual.length == 2 && actual.all? { |row| row.length == expected[0].length }
  2.times do |p|
    actual[p].each_with_index do |v, i|
      b = expected[p][i]
      raise "value #{p}/#{i}: #{v} != #{b}" unless (v - b).abs < 1e-8 * [1, b.abs].max
    end
  end
end

n = Integer(ARGV[0])
[2, 4, 8, 16, 32].each do |count|
  small = Array.new(count) { |i| Math.sin(i * 1.71) + Math.cos(i * 0.37) }
  expected = [:cos, :sin].map do |trig|
    Array.new(count) { |k| small.each_with_index.sum { |v, j| v * Math.public_send(trig, -2 * Math::PI * k * j / count) } }
  end
  check(fft(small), expected)
end
samples = Array.new(n) { |j| Math.sin(2 * Math::PI * 17 * j / n) + 0.3 * Math.cos(2 * Math::PI * 41 * j / n) }
expected = [Array.new(n) { |k| [41, n - 41].include?(k) ? 0.15 * n : 0 },
            Array.new(n) { |k| k == 17 ? -n / 2.0 : k == n - 17 ? n / 2.0 : 0 }]
check(fft(samples), expected)
if ARGV[1] == "validate"
  puts JSON.generate({ruby: RUBY_DESCRIPTION, yjit: RubyVM::YJIT.enabled?, valid: true})
  exit
end
clock = -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
cpu_clock = -> { Process.clock_gettime(Process::CLOCK_PROCESS_CPUTIME_ID) }
start = clock.call
fft(samples) while clock.call - start < 1.5
measured = Array.new(3) do
  cpu, start, calls, result = cpu_clock.call, clock.call, 0, nil
  begin
    result = fft(samples)
    calls += 1
  end while clock.call - start < 0.75
  elapsed, used = clock.call - start, cpu_clock.call - cpu
  check(result, expected)
  { iterations: calls, warmMs: 1000 * elapsed / calls, cpuMs: 1000 * used / calls }
end
median = ->(values) { values.sort[values.length / 2] }
puts JSON.generate({ ruby: RUBY_DESCRIPTION, yjit: RubyVM::YJIT.enabled?, n: n,
  warmMs: median.call(measured.map { |r| r[:warmMs] }),
  cpuMs: median.call(measured.map { |r| r[:cpuMs] }), measured: measured })
