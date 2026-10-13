require 'json'
require 'set'

def by_permutations(n)
  result = []
  (0...n).to_a.permutation do |q|
    next unless q.each_with_index.map { |col, i| col + i }.uniq.length == n
    if q.each_with_index.map { |col, i| col - i }.uniq.length == n
      result << q
    end
  end
  result
end

def by_prefixes(n)
  states = [Array.new(n, 0)]
  (0...n).each do |row|
    dy = (0...row).map { |i| row - i }
    indices = []
    states.each_with_index do |state, parent|
      q = state.take(row)
      blocked = Set.new(q + q.each_with_index.map { |col, i| col + dy[i] } +
                        q.each_with_index.map { |col, i| col - dy[i] })
      (0...n).each { |col| indices << parent * n + col unless blocked.include?(col) }
    end
    return [] if indices.empty?
    states = indices.map { |index| states[index / n].dup }
    states.each_with_index { |state, i| state[row] = indices[i] % n }
  end
  states
end

name = ARGV[0]
raise 'unknown algorithm' unless %w[permutations prefixes].include?(name)
solve = method(name == 'permutations' ? :by_permutations : :by_prefixes)
start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
warm = solve.call(8)
warm_ms = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - start) * 1000
iterations = [[(200 / [warm_ms, 0.1].max).ceil, 1].max, 1000].min
checksum = 0
solutions = nil
start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
iterations.times do
  solutions = solve.call(8)
  checksum += solutions.length
end
ms = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - start) * 1000 / iterations
raise 'wrong result' unless checksum == 92 * iterations && solutions == warm
puts JSON.generate(ms: ms, iterations: iterations, checksum: checksum,
                   solutions: solutions, version: RUBY_DESCRIPTION)
