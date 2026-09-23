# NPU and GPU tensor backends: research notes

See [Mobile hardware and live shaders](mobile-graphics.md) for camera, audio,
sensor and shader ideas that complement the inference work below.

Recorded 2026-09-13. This is a proposal for experiments. Rank has no NPU backend,
and the module names and syntax below are not implemented or accepted language API.

## Two possible features

An inference module could load an existing model, accept Rank arrays as inputs,
and return arrays. A later compiler backend could translate a supported subset
of Rank tensor computations into an accelerator graph. Loading models is a
smaller first implementation than compiling user functions.

Illustrative model-loading syntax:

```text
use inference

Model = "classifier.onnx" model
Result = Input Model predict
```

The proposed module would expose vocabulary through `use`; device selection
would be a separate execution setting. A module import alone cannot guarantee
that operations execute on an NPU.

Rank already has array shapes, `matmul`, and a tensor expression representation
in [tensor-kernel.ts](../../packages/interpreter/src/tensor-kernel.ts). This is a
starting point for a backend, not an existing portable accelerator compiler.
Readable temporary variables can remain in source while the compiler combines
their operations into one graph:

```text
Product = X W matmul
Scores = Product + Bias
Result = Scores sigmoid
```

This graph need not represent a trained network. It can express a supported
mathematical computation on tensors. Arbitrary loops, generators, effects, and
exact integer algorithms would remain outside an initial backend.

## Hardware and APIs

| Target | Candidate API | Access and limits |
| --- | --- | --- |
| MacBook M5 and iPhones with Neural Engine | Core ML | Swift / Objective-C model execution. CPU, GPU and Neural Engine placement depends on the model and runtime. |
| M5 GPU Neural Accelerators | Metal 4 tensor APIs | A separate route for tensor computations on GPU hardware; distinct from the Neural Engine. |
| Pixel 7, Tensor G2 | Investigate legacy NNAPI support | Current Google Tensor SDK documentation does not list G2. Modern NPU support on this phone is unconfirmed. |
| Nothing Phone 3a, Snapdragon 7s Gen 3 | Qualcomm QNN / AI Engine Direct, possibly through LiteRT | Native backend libraries; LiteRT offers Kotlin and C/C++ integration. Exact phone, driver and operator compatibility needs a device test. |

Core ML permits CPU plus Neural Engine execution, but has no Neural-Engine-only
compute-unit setting. Profiling must establish actual placement rather than
inferring it from the requested policy.
[Core ML compute units](https://developer.apple.com/documentation/coreml/mlcomputeunits).

Apple exposes M5 GPU Neural Accelerators through Metal 4 tensor APIs. This is a
candidate for general Rank array acceleration alongside the Core ML experiment.
[Apple M5 announcement](https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/).

Google's Tensor SDK supported-SoC list does not include the Pixel 7's Tensor G2.
NNAPI was deprecated in Android 15. Do not assume that an NPU present in hardware
is accessible through a current SDK on every phone.
[Pixel specifications](https://support.google.com/pixelphone/answer/7158570?hl=en),
[Google Tensor SDK](https://developers.google.com/edge/litert/next/tensor-sdk),
[NNAPI migration guide](https://developer.android.com/ndk/guides/neuralnetworks/migration-guide).

Nothing lists Snapdragon 7s Gen 3 for Phone 3a. Qualcomm provides graph execution
APIs, and LiteRT integrates vendor NPU libraries. These facts establish a route
to investigate, not verified support for this particular phone.
[Phone 3a](https://in.nothing.tech/products/phone-3a),
[Qualcomm AI Engine Direct](https://www.qualcomm.com/developer/software/qualcomm-ai-engine-direct-sdk),
[LiteRT NPU integration](https://developers.google.com/edge/litert/next/npu).

## TypeScript and native integration

Rank currently runs on Node.js. A Node-API addon could bridge to native code.
Bun also supports Node-API addons and offers `bun:ffi` for C-compatible library
interfaces; changing the runtime is not a prerequisite. A possible Apple bridge
is an Objective-C++ wrapper with a small C interface around Core ML.
[Bun Node-API](https://bun.sh/docs/runtime/node-api),
[Bun FFI](https://bun.sh/docs/runtime/ffi).

ONNX Runtime has a Node package and a Core ML execution provider, but its
documented prebuilt Node package matrix does not list Core ML. Installing
`onnxruntime-node` alone is not evidence of Neural Engine access. Evaluate a
custom build or a dedicated bridge before choosing this dependency.
[Node package support](https://onnxruntime.ai/docs/get-started/with-javascript/node.html),
[Core ML execution provider](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html).

Phones also need an application host with a JavaScript engine and the native
libraries for that OS. A desktop Bun addon does not supply that mobile host.

## Future zero-copy tensor handoff

A materialized numeric Rank tensor could hold a contiguous typed buffer plus
its shape. If its element type and layout match a model input, an ONNX Runtime
adapter could pass that buffer to `Tensor.fromPinnedBuffer` without first
building another JS array. This is a reason to design [compact array
storage](array-element-types.md) and the inference boundary together. It is
not possible with today's ordinary Rank arrays, whose numeric cells live in
JS arrays. [ONNX Runtime tensor factory](https://onnxruntime.ai/docs/api/js/interfaces/TensorFactory.html).

The adapter must keep the buffer alive and prevent writes while inference uses
it. A Rank write during that period would need to wait or take a copy. Lazy
results, non-contiguous views and inputs requiring a different element type or
layout still need materialization or conversion. Exact Rank integers cannot be
silently narrowed to a fixed-width model input.

This is a possible no-copy *handoff* at the Rank/ONNX boundary, not a promise
that ONNX Runtime will avoid copies during execution or transfer to a GPU.
Test buffer identity, ownership and full inference time with a specific Node
binding and model before claiming an end-to-end zero-copy path. The choice of
typed storage and the public Rank API remain open.

## Proposed first experiment

Start on a Mac M5 with one reusable `matmul -> add bias -> sigmoid` graph.
Use Core ML to investigate the Neural Engine, or Metal 4 to investigate GPU
tensor acceleration. Keep the experiment separate from default Rank semantics.

1. Define input shapes and explicit numeric conversions. Ordinary Rank integers
   and reals must not silently become lower-precision accelerator values.
2. Compare every output against an independent CPU reference with documented
   tolerances appropriate to the selected precision.
3. Measure compilation, first execution, data transfer, repeated execution and
   complete application time separately, across small and larger inputs.
4. Verify hardware placement with platform profiling. Report unsupported
   operators and any CPU/GPU fallback.
5. Use those results to decide the compilation boundary, buffer lifetime,
   synchronous/asynchronous host integration and public API.

No speedup or energy saving has been measured. Current open choices include
model loading versus Rank graph compilation, supported dtypes and shapes, and
whether unsupported graphs fail explicitly or use a reported fallback.

See [Tensor fusion architecture](tensor-fusion.md) and
[Array element types](array-element-types.md) for related language constraints.

## Competition tasks to revisit

Mobile AI provides tasks explicitly evaluated on mobile accelerators. Its
[workshop index](https://ai-benchmark.com/workshops/mai/2025/) distinguishes NPU
tracks from GPU tracks. Useful archived targets include:

- [Quantized image super-resolution, 2025 report](https://openaccess.thecvf.com/content/CVPR2025W/MAI/papers/Ignatov_Quantized_Image_Super-Resolution_on_Mobile_NPUs_Mobile_AI_2025_Challenge_CVPRW_2025_paper.pdf):
  reconstruct higher-resolution images; the evaluation target was Google Tensor NPU.
- [4K quantized image super-resolution, 2026](https://codalab.lisn.upsaclay.fr/competitions/21487):
  the workshop lists Snapdragon 8 Elite NPU as the target.
- [Efficient Stable Diffusion, 2026](https://codalab.lisn.upsaclay.fr/competitions/21869):
  the workshop lists Apple M4 Neural Engine as the target.

The two linked 2026 competition pages list an end date of March 17, 2026.
Treat them as practice material, not currently open contests. Running on an M5
or another phone is a local experiment, not a reproduction of the official
hardware score. Dataset access and submission formats need checking before use.

For a smaller first exercise, consider
[Kaggle Digit Recognizer](https://www.kaggle.com/competitions/digit-recognizer/overview).
A proposed Rank experiment would run a small digit classifier on the accelerator
and measure latency locally; NPU performance is not the competition objective.
Training can remain external while Rank first implements inference.

[MLPerf Mobile](https://mlcommons.org/2026/06/mlperf-mobile-v6/) supplies mobile
inference benchmarks, including image tasks and LLMs. It is a benchmark suite,
not a programming puzzle contest, and could later guide backend validation.

## Staged implementation plan

Saved 2026-09-13. All stages are pending. Start on the Mac M5; choose the public
module API after validating the native bridge. This plan records future work,
not a claim of implemented support.

### 1. Digit recognition: prove the bridge

Use Digit Recognizer as the first complete example. Train a small classifier
outside Rank and retain its weights, preprocessing and CPU reference outputs.
First validate the simple graph described above, then run the classifier through
a Core ML bridge from Rank arrays to model inputs and back to Rank arrays.
Keep numeric conversions explicit and reuse the loaded model between calls.

Completion criteria:

- A reproducible Rank example reads images and returns predicted digits.
- Output scores match the reference within a documented numeric tolerance;
  classification accuracy is reported on a held-out labelled set.
- Profiling confirms which operations use the Neural Engine and which fall back.
- Measurements separate model preparation, first call, repeated inference and
  complete input/output handling, with a CPU baseline and recorded environment.

A measured lack of speedup is a valid result for this small workload. It must
not be hidden by excluding transfer or startup costs.

### 2. Image super-resolution: test a larger workload

Use an archived Mobile AI super-resolution task. Check dataset availability,
terms and model format before preparing a reproducible example. Start with a
small supported convolutional model, then investigate explicit quantization
and larger images, including 4K if memory permits.

Completion criteria:

- Rank runs the complete image preprocessing, model invocation and output path.
- Image quality is evaluated using the chosen task's published metric.
- Latency and peak memory are measured alongside quality before and after
  quantization, with hardware placement and fallback reported.
- Mac M5 measurements are labelled as local results; comparisons with official
  scores identify the different hardware and runtime.

Use these results to settle reusable buffer handling and missing tensor
operations. A later Android port must verify support on each actual device;
the Pixel 7 and Nothing Phone 3a remain unverified targets.

### 3. Stable Diffusion: test a complete model pipeline

Use the archived Efficient Stable Diffusion task as a later Apple target.
First establish a working native reference, then expose model execution through
Rank. Keep training external and check model licensing and distribution terms
before adding artifacts to the repository.

Completion criteria:

- A reproducible example records the model version, prompts, seed, image size
  and sampling settings, and produces images through the Rank host.
- Evaluation reports the task's quality metric, complete generation latency,
  model loading and peak memory.
- Profiling records placement across CPU, GPU and Neural Engine for the pipeline.

After each stage, record commands, artifacts, correctness checks, measurements
and unresolved limitations in the wiki. Decide whether compiling Rank functions
into accelerator graphs is justified by these examples before expanding the
language or making device selection automatic.
