# LeetCode examples

These examples use only the current Rank design.

## 1. Two Sum

```rank
rem LeetCode 1: Two Sum
rem Return indices of two values
rem whose sum equals Target.

fun two_sum A Target
  for Value i in A
    Need = Target - Value

    if Need in index
      J = index Need
      return array J i
    end

    index Value = i
  end
end
```

This demonstrates:
- `array 2 7 11 15` construction and `A i` addressing;
- explicit value/index binding `for Value i in A`;
- user-defined functions and `return`;
- implicit `index`;
- keyed membership and lookup.

## 2. Add Two Numbers

```rank
rem LeetCode 2: Add Two Numbers
rem Add reverse-order digit arrays.

fun add_two A B
  N = A len
  M = B len
  Size = N

  if M greater Size
    Size = M
  end

  Carry = 0
  I = 0

  for I less Size
    X = 0
    Y = 0

    if I less N
      X = A I
    end

    if I less M
      Y = B I
    end

    Sum = X + Y + Carry
    queue push Sum % 10
    Carry = Sum // 10
    I += 1
  end

  if Carry greater 0
    queue push Carry
  end

  return queue
end
```

This uses condition-controlled `for`, ordinary array addressing and one
function-local queue. It does not require padded stacking.

## 3. Longest Substring Without Repeating Characters

```rank
rem LeetCode 3: Longest Substring
rem Find the longest window containing
rem no repeated character.

fun longest Text
  Start = 0
  Best = 0

  for C i in Text
    if C in index
      Last = index C

      if Last at least Start
        Start = Last + 1
      end
    end

    index C = i
    Size = i - Start + 1

    if Size greater Best
      Best = Size
    end
  end

  return Best
end
```

The two loop bindings explicitly receive the current Unicode code point and
its zero-based index. The local `index` stores each character's latest position.
The solution uses only current Rank constructs and runs in linear time.

## 4. Median of Two Sorted Arrays

The runnable example in `demos/leetcode/004_medarrs.ra` uses binary partitioning
and keeps the required `O(log(m+n))` running time. It demonstrates `at most`,
Python-style `//`, real `/`, and the data-first binary forms `A B min` and
`A B max`. Array boundaries are handled explicitly, so the algorithm does not
need sentinel infinities even though `use numbers` provides `infinity`.

## 5. Longest Palindromic Substring

The runnable example in `demos/leetcode/005_longestpal.ra` expands around every
possible odd and even center. It uses ordinary conditional `for` loops rather
than adding `break`, and extracts each better result directly:

```rank
Best = Text from L to R
```

Text slices count Unicode code points. The example runs in quadratic time and
constant auxiliary space apart from the returned text value.

## 9. Palindrome Number

Text version:

```rank
rem LeetCode 9: Palindrome Number
rem Check whether X reads the same
rem forward and backward.

fun palindrome X
  Text = X text
  Back = Text reverse

  return Text equal Back
end
```

Follow-up without text conversion:

```rank
rem Follow up:
rem Do not convert X to text.

fun palindrome X
  if X less 0
    return false
  end

  if X % 10 equal 0
    if X not equal 0
      return false
    end
  end

  Back = 0

  for X greater Back
    Digit = X % 10
    X = X // 10

    Back = Back * 10 + Digit
  end

  if X equal Back
    return true
  end

  return X equal Back // 10
end
```
