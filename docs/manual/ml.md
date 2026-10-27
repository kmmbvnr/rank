# ml manual

## relu

Replace negative real values with zero.

```rank
use ml
(array -2.0 0.0 3.0) relu
```

```result
0 0 3
```

### Usage

```text
Value relu
```

Maps across real arrays, keeping their
shape. Ordinary Rank runs this on CPU.

An imported `.ram` module compiles its
fixed-shape ReLU graph for the selected
GPU runtime. Open GPU Hello World in the
app menu for an example with a RAM tab.
