# Rewrite this Rank program in Rust

You do not need prior knowledge of Rank or access to its repository. This file
supplies the source, language rules and parsed structure for the rewrite.
Create a standalone Cargo project with src/main.rs, or fill in the prepared project.
Use the source, syntax tree,
name/type/loop facts and semantic contract below. Preserve the algorithm's observable
behavior across inputs. Do not hardcode answers from tests. Do not change source.ra,
cases.json or rank-compile.json to make verification pass.

Integer policy: **exact**. Use signed arbitrary-precision integers for Rank integers. Declare num-bigint as below. Only use machine indices after checking conversion and bounds.

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
name = "rank-004_palproduct-exact"
version = "0.1.0"
edition = "2021"
publish = false

[dependencies]
num-bigint = "0.4"

[profile.release]
overflow-checks = true
```

## Source: 004_palproduct.ra

SHA-256: 6b6f27c812291c0f737fa14f1ed21338eee2be5faac15435347c8094446b38e9

```rank
rem Largest Palindrome Product
rem https://projecteuler.net/problem=4
rem Largest palindrome made from the
rem product of two N-digit numbers

use text
use io
use cli

rem Number of digits in each factor.
option Digits integer = 3

Lower = 10 ** (Digits - 1)
Upper = Lower * 10 - 1

Factors = Lower to Upper
Products = Factors Factors * outer
Mask = Products palindrome rank 0
Palindromes = Products Mask

Answer = Palindromes max

Answer print

rem Return true when a nonnegative integer
rem reads the same in both directions.
fun palindrome X
  Text = X text
  Back = Text reverse
  return Text equal Back
end
```

## Existing tests (context, not a substitute for general behavior)

```rank
use testing

test "default input"
  use "004_palproduct"
  run

  Answer equal 906609
end

test "two-digit factors"
  use "004_palproduct"
  Digits = 2
  run

  Answer equal 9009
end

test "one-digit factors"
  use "004_palproduct"
  Digits = 1
  run

  Answer equal 9
end
```

## Resolved syntax and analysis

This is a parsed syntax tree with binding facts, not a lowered IR or a proof of purity.
Unknown types remain unknown. Integer literals are decimal strings tagged integer.

```json
{
  "modules": [
    "text",
    "io",
    "cli"
  ],
  "scopes": [
    {
      "kind": "program",
      "name": "program",
      "at": {
        "line": 1,
        "column": 31
      },
      "bindings": [
        {
          "name": "palindrome",
          "kind": "function",
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
              "line": 18,
              "column": 17
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "function",
          "arities": [
            1
          ]
        },
        {
          "name": "Digits",
          "kind": "option",
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
              "column": 16
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "integer"
        },
        {
          "name": "Lower",
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
              "line": 14,
              "column": 9
            },
            {
              "line": 16,
              "column": 11
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "integer or real"
        },
        {
          "name": "Upper",
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
              "line": 16,
              "column": 20
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "integer or real"
        },
        {
          "name": "Factors",
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
              "line": 17,
              "column": 12
            },
            {
              "line": 17,
              "column": 20
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "sequence"
        },
        {
          "name": "Products",
          "kind": "assignment",
          "bound": {
            "line": 17,
            "column": 1
          },
          "writes": [
            {
              "line": 17,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 18,
              "column": 8
            },
            {
              "line": 19,
              "column": 15
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "unknown"
        },
        {
          "name": "Mask",
          "kind": "assignment",
          "bound": {
            "line": 18,
            "column": 1
          },
          "writes": [
            {
              "line": 18,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 19,
              "column": 24
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "unknown"
        },
        {
          "name": "Palindromes",
          "kind": "assignment",
          "bound": {
            "line": 19,
            "column": 1
          },
          "writes": [
            {
              "line": 19,
              "column": 1
            }
          ],
          "reads": [
            {
              "line": 21,
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
    },
    {
      "kind": "function",
      "name": "palindrome",
      "at": {
        "line": 27,
        "column": 1
      },
      "bindings": [
        {
          "name": "X",
          "kind": "parameter",
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
          "name": "Text",
          "kind": "assignment",
          "bound": {
            "line": 28,
            "column": 3
          },
          "writes": [
            {
              "line": 28,
              "column": 3
            }
          ],
          "reads": [
            {
              "line": 29,
              "column": 10
            },
            {
              "line": 30,
              "column": 10
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "text"
        },
        {
          "name": "Back",
          "kind": "assignment",
          "bound": {
            "line": 29,
            "column": 3
          },
          "writes": [
            {
              "line": 29,
              "column": 3
            }
          ],
          "reads": [
            {
              "line": 30,
              "column": 21
            }
          ],
          "reassigned": false,
          "unused": false,
          "loopCarried": false,
          "shadows": false,
          "types": "text"
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
          "line": 21,
          "column": 22
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
          "line": 23,
          "column": 8
        }
      ]
    },
    {
      "name": "reverse",
      "module": "text",
      "arities": [
        1
      ],
      "form": "Text reverse",
      "result": "text",
      "summary": "Reverses text by Unicode code point.",
      "sites": [
        {
          "line": 29,
          "column": 15
        }
      ]
    },
    {
      "name": "text",
      "module": "core",
      "arities": [
        1
      ],
      "form": "Value text",
      "result": "text",
      "summary": "Formats one scalar as text; a .Nf literal after it selects fixed decimals.",
      "sites": [
        {
          "line": 28,
          "column": 12
        }
      ]
    }
  ],
  "syntax": {
    "$type": "Program",
    "statements": [
      {
        "$type": "UseStatement",
        "module": "text"
      },
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
        "name": "Digits",
        "valueType": "integer",
        "defaultValue": {
          "$type": "NumberLiteral",
          "value": {
            "integer": "3"
          }
        },
        "many": false
      },
      {
        "$type": "AssignmentStatement",
        "name": "Lower",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "NumberLiteral",
            "value": {
              "integer": "10"
            }
          },
          "operator": "**",
          "right": {
            "$type": "ParenthesizedExpression",
            "value": {
              "$type": "BinaryExpression",
              "left": {
                "$type": "NameExpression",
                "name": "Digits"
              },
              "operator": "-",
              "right": {
                "$type": "NumberLiteral",
                "value": {
                  "integer": "1"
                }
              }
            }
          }
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "Upper",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "BinaryExpression",
            "left": {
              "$type": "NameExpression",
              "name": "Lower"
            },
            "operator": "*",
            "right": {
              "$type": "NumberLiteral",
              "value": {
                "integer": "10"
              }
            }
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
      {
        "$type": "AssignmentStatement",
        "name": "Factors",
        "operator": "=",
        "value": {
          "$type": "BinaryExpression",
          "left": {
            "$type": "NameExpression",
            "name": "Lower"
          },
          "operator": "to",
          "right": {
            "$type": "NameExpression",
            "name": "Upper"
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
            "$type": "ApplicationExpression",
            "head": {
              "$type": "NameExpression",
              "name": "Factors"
            },
            "arguments": [
              {
                "$type": "NameExpression",
                "name": "Factors"
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
        "name": "Mask",
        "operator": "=",
        "value": {
          "$type": "ApplicationExpression",
          "head": {
            "$type": "ApplicationExpression",
            "head": {
              "$type": "ApplicationExpression",
              "head": {
                "$type": "NameExpression",
                "name": "Products"
              },
              "arguments": [
                {
                  "$type": "NameExpression",
                  "name": "palindrome"
                }
              ]
            },
            "arguments": [
              {
                "$type": "NameExpression",
                "name": "rank"
              }
            ]
          },
          "arguments": [
            {
              "$type": "NumberLiteral",
              "value": {
                "integer": "0"
              }
            }
          ]
        }
      },
      {
        "$type": "AssignmentStatement",
        "name": "Palindromes",
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
              "name": "Mask"
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
            "name": "Palindromes"
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
      },
      {
        "$type": "FunctionStatement",
        "name": "palindrome",
        "parameters": [
          "X"
        ],
        "statements": [
          {
            "$type": "AssignmentStatement",
            "name": "Text",
            "operator": "=",
            "value": {
              "$type": "ApplicationExpression",
              "head": {
                "$type": "NameExpression",
                "name": "X"
              },
              "arguments": [
                {
                  "$type": "NameExpression",
                  "name": "text"
                }
              ]
            }
          },
          {
            "$type": "AssignmentStatement",
            "name": "Back",
            "operator": "=",
            "value": {
              "$type": "ApplicationExpression",
              "head": {
                "$type": "NameExpression",
                "name": "Text"
              },
              "arguments": [
                {
                  "$type": "NameExpression",
                  "name": "reverse"
                }
              ]
            }
          },
          {
            "$type": "ReturnStatement",
            "value": {
              "$type": "BinaryExpression",
              "left": {
                "$type": "NameExpression",
                "name": "Text"
              },
              "operator": "equal",
              "right": {
                "$type": "NameExpression",
                "name": "Back"
              }
            }
          }
        ],
        "memo": false
      }
    ]
  }
}
```
