# Lexical syntax

## Naming

Standard language words are lowercase:

```rank
for
while
sum
queue
index
sqrt
```

Ordinary user variables are capitalized:

```rank
Data
Target
Result
Features
```

Loop and mathematical indices are lowercase:

```rank
i
j
k
```

## Comments

Comments use classic BASIC `rem`:

```rank
rem Compute the answer
Sum = 0
```

`rem` is lexical core and does not require a module.

## Assignment

`=` is assignment:

```rank
Result = 10
Data .Age = Age
index Key = Value
```

Compound assignment updates an existing variable without repeating the left
side inside the expression:

```rank
Total += Value
Total -= Cost
Product *= Factor
Index %= Size
Mask and= Active
Mask or= Fallback
Mask xor= Changed
```

The current compound assignment operators are `+=`, `-=`, `*=`, `/=`, `%=`,
`and=`, `or=` and `xor=`.

## Data-first application

Rank places data before the operation. A called function is the final word of
an application:

```rank
30 sin
A B gcd
Range lcm
Answer print
Model X predict
```

This is the canonical call order for standard-library and user-defined
functions. Nullary sources such as `fibonacci` and `primes` are values rather
than calls. Keywords such as `use`, `run`, `option` and `if` introduce their own
statements and do not follow the function-call rule.

One application calls one function. Use a named intermediate value instead of
placing several function words on one line:

```rank
Text = N text
Back = Text reverse
```

This is both a language rule and the preferred narrow-screen style.

Conditions use words such as `equal` rather than `==`:

```rank
if X equal 0
    return true
end
```

Current comparison vocabulary includes:

```rank
equal
not equal
less
greater
```

Exact spelling for `<=` and `>=` is still open.

## Labels

A leading dot creates a literal label:

```rank
.Age
.Sex
.Pclass
.UserId
```

Labels are first-class values, not strings.

```rank
Column = .Age
Values = Data Column
```

Use `text` when a textual representation is needed:

```rank
Name = .Age text
```

## Strings

Strings use quotes:

```rank
Text = "hello"
```

The editor should make quotes cheap to enter, but quotes remain ordinary source syntax.
