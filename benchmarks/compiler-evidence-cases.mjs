import { readFileSync } from 'node:fs';
export const cases = {
    euler001: readFileSync(new URL('../demos/euler/001_multiples.ra', import.meta.url), 'utf8'),
    scalar: 'Total = 0\nfor I in 1 to 1000\n Total += I * 2\nend\nTotal',
    ownership: `fun A pass
 return A
end
Values = array 1 2 3
Saved = Values
for I in 1 to 100
 Saved = Values pass
 Values 0 += I
end
tuple Values Saved`,
    deferred: `fun X' twice
 return X + X
end
Total = 0
for I in 1 to 100
 Value' = I * 2
 Total += Value twice
end
Total`,
    effects: `use io
fun N work
 try
  N print
  return N * 2
 finally
  "closed" print
 end
end
Total = 0
for I in 1 to 100
 Total += I work
end
Total`,
    generator: `fun values
 for N in 1 to 100
  try
   yield N
  finally
   yield N + 10
  end
 end
end
values array`,
    large: `use io
fun N work
${' N += 1\n'.repeat(300)} N print
 return N
end
Total = 0
for I in 1 to 30
 Total += I work
end
Total`,
    error: 'use io\n"before" print\nValue = 1\nValue = "invalid"\nValue',
};
