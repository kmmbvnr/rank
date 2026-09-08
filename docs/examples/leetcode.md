# LeetCode examples

These examples use only the current Rank design.

## 1. Two Sum

```rank
rem LeetCode 1: Two Sum
rem Return indices of two values
rem whose sum equals Target.

fun two_sum A Target
    for Ai in A
        Need = Target - Ai

        if Need in index
            return index Need, i
        end

        index Ai = i
    end
end
```

This demonstrates:
- `for Ai in A`;
- implicit `index`;
- keyed membership and lookup.

## 9. Palindrome Number

Text version:

```rank
rem LeetCode 9: Palindrome Number
rem Check whether X reads the same
rem forward and backward.

fun palindrome X
    Text = text X
    Back = reverse Text

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

    while X greater Back
        Digit = X % 10
        X = X / 10

        Back = Back * 10 + Digit
    end

    if X equal Back
        return true
    end

    return X equal Back / 10
end
```

## Regular expression matching

The DP notation can use compact mathematical indexing:

```rank
DP00 = true
DPij = DPi q
```

This is one reason compact `Aij` notation exists in Rank.
