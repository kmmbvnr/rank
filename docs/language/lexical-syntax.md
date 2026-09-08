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
Name = text .Age
```

## Strings

Strings use quotes:

```rank
Text = "hello"
```

The editor should make quotes cheap to enter, but quotes remain ordinary source syntax.
