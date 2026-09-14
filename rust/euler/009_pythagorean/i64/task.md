# Rewrite this Rank program in Rust

You do not need prior knowledge of Rank or access to its repository. This file
supplies the source, language rules and parsed structure for the rewrite.
Create a standalone Cargo project with src/main.rs, or fill in the prepared project.
Use the source, syntax tree,
name/type/loop facts and semantic contract below. Preserve the algorithm's observable
behavior across inputs. Do not hardcode answers from tests. Do not change source.ra,
cases.json or rank-compile.json to make verification pass.

Integer policy: **i64**. Use signed i64 with checked arithmetic and input parsing. Overflow must fail with a diagnostic containing overflow or out of range. Never wrap or silently round. Cargo overflow checks must remain enabled.

Accept the source program's integer options as --lowercase-name VALUE, with their
declared defaults. Print the same stdout including its final newline. Invalid inputs
must exit nonzero with a diagnostic on stderr. Do not print build/debug logs to stdout.
Build with cargo build --release. If this is a prepared project with rank-compile.json,
run npx @arrrank/compile verify on its directory. Otherwise compare the included
examples and add boundary cases; full verification can be set up with the prepare command.
Repair counterexamples by editing the generated Rust. Finite checks are not a proof.

Initial validation covers Project Euler 1–10. This exporter does not prove that a
different parsed program can be translated. Unhandled semantics must be reported,
not silently approximated. No external agent is run by rank-compile.

## Reading Rank without prior knowledge

Rank is a data-first language. Source uses one statement per line; `rem` starts
a comment. `use NAME` opens a standard vocabulary. Capitalized names denote
values; lowercase words name operations and functions. `X = expression` creates
or replaces a binding, while `X += Y`, `X *= Y`, `X or= Y` and `X and= Y` update it.
These updates use previously bound X. Named sequences and arrays may be reused.

`option Limit integer = 100` declares a command-line integer input, with default
100 and override `--limit VALUE`. Integer literals have arbitrary precision.
String literals are quoted. A trailing `Answer print` writes its decimal value
and a newline. `use cli` and `use io` open options/output, not implicit I/O effects.

Functions apply to the data on their left: `N factors` means factors(N), and
`Values sum` means sum(Values). Binary expressions use ordinary infix arithmetic
with multiplication before addition and explicit parentheses. Function chains
flow left to right: `Fib even sum` means sum(filter_even(Fib)). Consult the parsed
syntax below for grouping; do not infer grouping from whitespace alone.

`fun palindrome X ... return Value ... end` declares a function of X. Function
declarations can appear after their calls. `X text` converts X to text, `Text
reverse` reverses it, and `Text equal Back` compares values. `less`, `greater`,
`atleast` and `atmost` mean <, >, >= and <=. `equal`/`notequal` are value equality.

`for I in Range ... end` visits Range in order and binds I. `if Condition ...
elif Other ... else ... end` selects a branch. `return` exits a function;
`break`/`continue` affect the enclosing loop. Conditional `for Condition ... end`
rechecks Condition before each iteration. Do not remove effects or change order.

`A B + outer` computes all pairwise sums with A on the first axis and B on the
second. `A B * outer` does the same for products. A vector on the right of a
matrix operation broadcasts along the last axis. `Values Mask` selects values
where a same-shaped boolean mask is true; scalar `Values Index` indexes instead.
In the first ten Euler programs, chained mask operations retain array shape.

## Numeric and sequence contract

Rank integers are signed arbitrary-precision values. Real numbers are a distinct
type: do not replace integers with f64. `//` is floor division and `%` follows the
divisor's sign; Rust signed division truncates, so translate negative operands
explicitly. Division by zero fails. Boolean operations evaluate both operands.

`A to B` is ascending and includes B. `A until B` excludes B. Empty ascending
ranges produce no elements. Sequence values are lazy and may be iterated again;
do not consume a named sequence once if it is reused later. Never assume an
arbitrary user generator is pure or finite.

`fibonacci` produces 1, 2, 3, 5, 8, ... . `primes` produces 2, 3, 5, 7, ... .
Sequence indexing starts at zero; negative positions on an unbounded sequence
are invalid. `fibonacci to Limit even sum` can fuse to an even-only recurrence
with previous=0, current=2, next=4*current+previous. Upper bounds still apply.

Numeric predicates such as `even` and `multiple by D` applied to sequences
produce selection/filter behavior used by the source. Preserve this context;
a scalar catalogue signature does not describe all sequence uses.

`sum` of an empty numeric collection is integer zero. `lcm` folds from integer
one; an empty collection gives one. `factors` yields prime factors with
multiplicity and requires a positive integer; factors of one is empty.
`max` on an empty collection fails. Preserve that failure rather than returning
zero or a default answer.

## Arrays, masks and loops

`A B * outer` evaluates every pair into a multidimensional result. Broadcasting
and axis/rank operations follow source shapes; `rank 0` applies to scalar cells,
and `rank 1` applies to rows. A boolean mask selects matching elements.
`Digits Width window` creates overlapping windows of positive width with default
stride one. Width greater than the input produces no windows. Reducing each
window with multiplication preserves all its digits, including zeros.

`integer rank 0` over digit text converts individual characters. `text` on a
nonnegative integer produces its decimal representation; reversing that text
and comparing it implements the palindrome helper in Euler 4.

Pure map/filter/reduce and outer-product selection may fuse into loops without
allocating intermediate arrays. Several named intermediates need not imply
separate passes. Prove purity and preserve error/evaluation order before fusing.
Arithmetic simplifications are allowed only under the selected numeric policy.
In i64 mode, require checked arithmetic for generated expressions as well.

The analysis records reads, writes, reassignment and loop-carried bindings. It
does not prove that callbacks lack effects or that arrays do not alias. Preserve
iteration order, live collection mutation, break/continue, returns and cleanup.
Keep unsupported effects explicit; never remove I/O, errors or cleanup to make
a loop faster. Do not translate runtime guards into unconditional assumptions.


## Cargo project

Use this manifest (there is no dependency on a Rank runtime):

```toml
[package]
name = "rank-009_pythagorean-i64"
version = "0.1.0"
edition = "2021"
publish = false

[dependencies]

[profile.release]
overflow-checks = true
```

## Source: 009_pythagorean.ra

SHA-256: 7af74e490e82990efce1b41836a02d732634758c3112453145eda1cce88b4f7c

```rank
rem Special Pythagorean Triplet
rem https://projecteuler.net/problem=9
rem Find a*b*c where a+b+c=1000 and
rem a^2+b^2=c^2

use io
use cli

option Target integer = 1000

ALast = (Target - 1) // 3
BLast = (Target - 1) // 2
A = 1 to ALast array
B = 2 to BLast array
PairSums = A B + outer
C = Target - PairSums

Increasing = A B less outer
Increasing and= B less C

ASquares = A ** 2
BSquares = B ** 2
SquareSums = ASquares BSquares + outer
Valid = SquareSums equal C ** 2
Valid and= Increasing

PairProducts = A B * outer
Products = PairProducts * C
Candidates = Products Valid
Answer = Candidates max

Answer print
```

## Existing tests (context, not a substitute for general behavior)

```rank
use testing

test "default input"
  use "009_pythagorean"
  run

  Answer equal 31875000
end

test "workspace input"
  use "009_pythagorean"
  Target = 12
  run

  Answer equal 60
end
```

## Resolved syntax and analysis

This is a parsed syntax tree with binding facts, not a lowered IR or a proof of purity.
Unknown types remain unknown. Integer literals are decimal strings tagged integer.

```json
{
  "modules": [
    "io",
    "cli"
  ],
  "scopes": [
    {
      "kind": "program",
      "name": "program",
      "at": {
        "line": 1,
        "column": 32
      },
      "bindings": [
        {
          "name": "Target",
          "kind": "option",
          "bound": {
            "line": 9,
            "column": 1
          },
          "writes": [
            {
              "line": 9,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 11,
              "column": 10
            },
            {
              "line": 12,
              "column": 10
            },
            {
              "line": 16,
              "column": 5
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "integer"
        },
        {
          "name": "ALast",
          "kind": "assignment",
          "bound": {
            "line": 11,
            "column": 1
          },
          "writes": [
            {
              "line": 11,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 13,
              "column": 10
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "integer"
        },
        {
          "name": "BLast",
          "kind": "assignment",
          "bound": {
            "line": 12,
            "column": 1
          },
          "writes": [
            {
              "line": 12,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 14,
              "column": 10
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "integer"
        },
        {
          "name": "A",
          "kind": "assignment",
          "bound": {
            "line": 13,
            "column": 1
          },
          "writes": [
            {
              "line": 13,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 15,
              "column": 12
            },
            {
              "line": 18,
              "column": 14
            },
            {
              "line": 21,
              "column": 12
            },
            {
              "line": 27,
              "column": 16
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "array"
        },
        {
          "name": "B",
          "kind": "assignment",
          "bound": {
            "line": 14,
            "column": 1
          },
          "writes": [
            {
              "line": 14,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 15,
              "column": 14
            },
            {
              "line": 18,
              "column": 16
            },
            {
              "line": 19,
              "column": 17
            },
            {
              "line": 22,
              "column": 12
            },
            {
              "line": 27,
              "column": 18
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "array"
        },
        {
          "name": "PairSums",
          "kind": "assignment",
          "bound": {
            "line": 15,
            "column": 1
          },
          "writes": [
            {
              "line": 15,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 16,
              "column": 14
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "unknown"
        },
        {
          "name": "C",
          "kind": "assignment",
          "bound": {
            "line": 16,
            "column": 1
          },
          "writes": [
            {
              "line": 16,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 19,
              "column": 24
            },
            {
              "line": 24,
              "column": 26
            },
            {
              "line": 28,
              "column": 27
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "unknown"
        },
        {
          "name": "Increasing",
          "kind": "assignment",
          "bound": {
            "line": 18,
            "column": 1
          },
          "writes": [
            {
              "line": 18,
              "column": 1
            },
            {
              "line": 19,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 19,
              "column": 1
            },
            {
              "line": 25,
              "column": 12
            }
          ],
          "reassigned": true,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "unknown"
        },
        {
          "name": "ASquares",
          "kind": "assignment",
          "bound": {
            "line": 21,
            "column": 1
          },
          "writes": [
            {
              "line": 21,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 23,
              "column": 14
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "array"
        },
        {
          "name": "BSquares",
          "kind": "assignment",
          "bound": {
            "line": 22,
            "column": 1
          },
          "writes": [
            {
              "line": 22,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 23,
              "column": 23
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "array"
        },
        {
          "name": "SquareSums",
          "kind": "assignment",
          "bound": {
            "line": 23,
            "column": 1
          },
          "writes": [
            {
              "line": 23,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 24,
              "column": 9
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "unknown"
        },
        {
          "name": "Valid",
          "kind": "assignment",
          "bound": {
            "line": 24,
            "column": 1
          },
          "writes": [
            {
              "line": 24,
              "column": 1
            },
            {
              "line": 25,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 25,
              "column": 1
            },
            {
              "line": 29,
              "column": 23
            }
          ],
          "reassigned": true,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "unknown"
        },
        {
          "name": "PairProducts",
          "kind": "assignment",
          "bound": {
            "line": 27,
            "column": 1
          },
          "writes": [
            {
              "line": 27,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 28,
              "column": 12
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "unknown"
        },
        {
          "name": "Products",
          "kind": "assignment",
          "bound": {
            "line": 28,
            "column": 1
          },
          "writes": [
            {
              "line": 28,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 29,
              "column": 14
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "unknown"
        },
        {
          "name": "Candidates",
          "kind": "assignment",
          "bound": {
            "line": 29,
            "column": 1
          },
          "writes": [
            {
              "line": 29,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 30,
              "column": 10
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "unknown"
        },
        {
          "name": "Answer",
          "kind": "assignment",
          "bound": {
            "line": 30,
            "column": 1
          },
          "writes": [
            {
              "line": 30,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 32,
              "column": 1
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "integer or real"
        }
      ]
    }
  ],
  "operations": [
    {
      "name": "max",
      "module": "core",
      "arities": [
        1,
        2
      ],
      "form": "Left max Right",
      "result": "number",
      "dyadicRanks": [
        0,
        0
      ],
      "summary": "Larger of two numbers, or the largest of one collection.",
      "sites": [
        {
          "line": 30,
          "column": 21
        }
      ]
    },
    {
      "name": "print",
      "module": "io",
      "arities": [
        1
      ],
      "form": "Value print",
      "result": "same",
      "effects": [
        "io"
      ],
      "summary": "Writes one line and returns the value, so a pipeline continues.",
      "sites": [
        {
          "line": 32,
          "column": 8
        }
      ]
    }
  ],
  "syntax": {
    "$type": "Program",
    "statements": [
      {
        "$type": "UseStatement",
        "module": "io"
      },
      {
        "$type": "UseStatement",
        "module": "cli"
      },
      {
        "$type": "OptionStatement",
        "name": "Target",
        "valueType": "integer",
        "defaultValue": {
          "$type": "NumberLiteral",
          "value": {
            "integer": "1000"
          }
        },
        "many": false
      },
      {
        "$type": "AssignmentStatement",
        "name": "ALast",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "ParenthesizedExpression",
            "value": {
              "$type": "BinaryExpression",
              "left": {
                "$type": "NameExpression",
                "name": "Target"
              },
              "operator": "-",
              "right": {
                "$type": "NumberLiteral",
                "value": {
                  "integer": "1"
                }
              }
            }
          },
          "operator": "//",
          "right": {
            "$type": "NumberLiteral",
            "value": {
              "integer": "3"
            }
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "BLast",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "ParenthesizedExpression",
            "value": {
              "$type": "BinaryExpression",
              "left": {
                "$type": "NameExpression",
                "name": "Target"
              },
              "operator": "-",
              "right": {
                "$type": "NumberLiteral",
                "value": {
                  "integer": "1"
                }
              }
            }
          },
          "operator": "//",
          "right": {
            "$type": "NumberLiteral",
            "value": {
              "integer": "2"
            }
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "A",
        "operator": "=",
        "value": {
          "$type": "MaterializeExpression",
          "source": {
            "$type": "BinaryExpression",
            "left": {
              "$type": "NumberLiteral",
              "value": {
                "integer": "1"
              }
            },
            "operator": "to",
            "right": {
              "$type": "NameExpression",
              "name": "ALast"
            }
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "B",
        "operator": "=",
        "value": {
          "$type": "MaterializeExpression",
          "source": {
            "$type": "BinaryExpression",
            "left": {
              "$type": "NumberLiteral",
              "value": {
                "integer": "2"
              }
            },
            "operator": "to",
            "right": {
              "$type": "NameExpression",
              "name": "BLast"
            }
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "PairSums",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "ApplicationExpression",
            "head": {
              "$type": "NameExpression",
              "name": "A"
            },
            "arguments": [
              {
                "$type": "NameExpression",
                "name": "B"
              }
            ]
          },
          "operator": "+",
          "right": {
            "$type": "NameExpression",
            "name": "outer"
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "C",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "NameExpression",
            "name": "Target"
          },
          "operator": "-",
          "right": {
            "$type": "NameExpression",
            "name": "PairSums"
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "Increasing",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "ApplicationExpression",
            "head": {
              "$type": "NameExpression",
              "name": "A"
            },
            "arguments": [
              {
                "$type": "NameExpression",
                "name": "B"
              }
            ]
          },
          "operator": "less",
          "right": {
            "$type": "NameExpression",
            "name": "outer"
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "Increasing",
        "operator": "and=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "NameExpression",
            "name": "B"
          },
          "operator": "less",
          "right": {
            "$type": "NameExpression",
            "name": "C"
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "ASquares",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "NameExpression",
            "name": "A"
          },
          "operator": "**",
          "right": {
            "$type": "NumberLiteral",
            "value": {
              "integer": "2"
            }
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "BSquares",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "NameExpression",
            "name": "B"
          },
          "operator": "**",
          "right": {
            "$type": "NumberLiteral",
            "value": {
              "integer": "2"
            }
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "SquareSums",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "ApplicationExpression",
            "head": {
              "$type": "NameExpression",
              "name": "ASquares"
            },
            "arguments": [
              {
                "$type": "NameExpression",
                "name": "BSquares"
              }
            ]
          },
          "operator": "+",
          "right": {
            "$type": "NameExpression",
            "name": "outer"
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "Valid",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "NameExpression",
            "name": "SquareSums"
          },
          "operator": "equal",
          "right": {
            "$type": "BinaryExpression",
            "left": {
              "$type": "NameExpression",
              "name": "C"
            },
            "operator": "**",
            "right": {
              "$type": "NumberLiteral",
              "value": {
                "integer": "2"
              }
            }
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "Valid",
        "operator": "and=",
        "value": {
          "$type": "NameExpression",
          "name": "Increasing"
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "PairProducts",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "ApplicationExpression",
            "head": {
              "$type": "NameExpression",
              "name": "A"
            },
            "arguments": [
              {
                "$type": "NameExpression",
                "name": "B"
              }
            ]
          },
          "operator": "*",
          "right": {
            "$type": "NameExpression",
            "name": "outer"
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "Products",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "NameExpression",
            "name": "PairProducts"
          },
          "operator": "*",
          "right": {
            "$type": "NameExpression",
            "name": "C"
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "Candidates",
        "operator": "=",
        "value": {
          "$type": "ApplicationExpression",
          "head": {
            "$type": "NameExpression",
            "name": "Products"
          },
          "arguments": [
            {
              "$type": "NameExpression",
              "name": "Valid"
            }
          ]
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "Answer",
        "operator": "=",
        "value": {
          "$type": "ApplicationExpression",
          "head": {
            "$type": "NameExpression",
            "name": "Candidates"
          },
          "arguments": [
            {
              "$type": "NameExpression",
              "name": "max"
            }
          ]
        }
      },
      {
        "$type": "ExpressionStatement",
        "value": {
          "$type": "ApplicationExpression",
          "head": {
            "$type": "NameExpression",
            "name": "Answer"
          },
          "arguments": [
            {
              "$type": "NameExpression",
              "name": "print"
            }
          ]
        }
      }
    ]
  }
}
```
