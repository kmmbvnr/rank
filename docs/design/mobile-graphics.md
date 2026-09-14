# Mobile hardware and live shaders

Recorded 2026-09-13. These are ideas for future experiments. The graphics module,
shader compiler and device APIs described here are not implemented. Syntax
examples are proposals, not current Rank programs.

See [NPU and GPU tensor backends](npu-backends.md) for the separate inference
plan, device limitations and competition tasks.

## Mobile capabilities worth exploring

| Capability | Example programs | Representation in Rank |
| --- | --- | --- |
| GPU compute | Game of Life, fractals, particles, heat diffusion, image filters | Arrays and grids transformed in parallel |
| Camera | Motion detection, edge filters, colour tracking | A sequence of image tensors |
| Microphone and audio output | Spectrogram, guitar tuner, synthesizer, audio filters | Blocks of samples with timing information |
| Accelerometer and gyroscope | Spirit level, gesture detection, vibration measurements | Timestamped vector records |
| Depth camera / LiDAR | Distance measurements, point clouds, room scanning | Depth maps and arrays of points |
| Haptics | Tactile metronome, rhythm playback, feedback | Timed patterns of impulses |

Native GPU routes include [Metal on Apple platforms](https://developer.apple.com/metal/)
and [Vulkan compute on Android](https://android-developers.googleblog.com/2021/04/android-gpu-compute-going-forward.html).
A browser prototype could use WebGPU from TypeScript: support was added in
[Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
and on supported Android configurations in
[Chrome 121](https://developer.chrome.com/blog/new-in-webgpu-121).
Check adapter availability, features and limits on each target device; browser
support does not establish that every phone or embedded web view will work.

Other public entry points include
[CameraX image analysis](https://developer.android.com/media/camera/camerax/analyze),
[AVAudioEngine](https://developer.apple.com/documentation/avfaudio/avaudioengine),
[Android sensors](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview),
[ARKit scene depth](https://developer.apple.com/documentation/arkit/arframe/scenedepth)
and [Core Haptics](https://developer.apple.com/documentation/corehaptics).
Device hardware and API availability vary; LiDAR is available only on some
devices. A host must handle the platform permissions required by its sources.

CPU vector libraries are also candidates. Apple's
[Accelerate](https://developer.apple.com/documentation/accelerate) provides FFT,
convolution and vector/matrix operations. Compare these with GPU execution for
small workloads where launch and transfer costs can dominate. No speedup has
been measured for these ideas in Rank.

## Arrays and recorded streams

Camera frames, audio blocks and sensor records could feed ordinary Rank
computations. The screen, speaker and haptic engine provide output. Device
modules would expose vocabulary through `use`, with acquisition and resource
lifetime managed by the host.

An editor could capture a short interval, then replay the same inputs after
code changes. This would make a camera filter or sensor algorithm reproducible
without repeating the physical movement. Connect this to the existing
[sequence preview and replay design](generator-previews.md).

Live acquisition continues independently of a rewind. Define recording length,
memory limits, timestamps and overflow behaviour explicitly. Replaying recorded
data cannot undo sound or vibration already emitted; output replay needs an
explicit policy. Frame dropping for a preview and lossless audio recording may
need different buffering policies.

## Fullscreen shaders as Rank functions

The proposed entry point is a function of coordinates and time returning a
colour. The renderer evaluates it in parallel for pixels. Start with fullscreen
procedural images before introducing geometry and a general 3D rendering API.

Illustrative animated rings:

```text
use numbers
use graphics

fun rings X Y Time
  Distance = X * X + Y * Y sqrt
  Wave = Distance * 20.0 - Time sin
  Light = Wave * 0.5 + 0.5
  return array Light 0.2 0.8
end

rings animate
```

Here the intended grouping is `sqrt(X * X + Y * Y)` and
`sin(Distance * 20.0 - Time)`, consistent with Rank's accumulated-expression
postfix rule. Temporary names keep the source narrow.

Proposed interface conventions:

- `X` and `Y` are centred coordinates scaled equally on both axes so circles
  remain circular. Final axis direction and coordinate range are still open.
- `Time` is elapsed time in seconds and can be frozen or scrubbed in the editor.
- The result contains RGB components in the range 0 to 1. Colour space, alpha
  and out-of-range behaviour need an explicit contract.
- `rings draw` renders a still at an explicit or documented default time;
  `rings animate` starts the host's frame loop. Both names are proposals.

Image size, pause, time controls and parameter sliders could live in the editor.
Touch input could control an effect's centre through explicit parameters.
Parameter binding and launch syntax remain undecided.

## Compilation and execution

Proposed browser path: Rank function -> typed shader representation -> WGSL ->
WebGPU. TypeScript prepares code and resources; the GPU executes the shader.
[WGSL](https://www.w3.org/TR/WGSL/) supports graphics and compute shaders.

The first compiler subset could include arithmetic, fixed-size vectors,
mathematical functions, conditions and calls to compatible helper functions.
Reject file access, generators and writes to external state with a source-level
diagnostic. Decide loop support separately; recursion and arbitrary dynamic
allocation are outside the first experiment.

GPU numeric precision must be explicit. An `f32` shader domain cannot silently
preserve the semantics of Rank's ordinary reals or arbitrary-precision integers.
Define how constants and parameters enter that domain before exposing the API.
Likewise, map a fixed-size colour result to GPU values without constructing a
JavaScript array for every pixel.

Keep rendering data on the GPU when possible. Reading full images back into
Rank arrays should be an explicit operation with its cost measured. Compilation
errors should point to the Rank source. A live editor could keep the last valid
frame visible while clearly marking a newer program as invalid.

## Experiment sequence and checks

All stages are pending:

1. Render a static gradient to prove the function-to-colour mapping, coordinate
   conventions, explicit precision and browser host.
2. Animate rings to test time, aspect ratio, touch parameters and live recompilation.
3. Render a fractal to investigate bounded iteration and more complex arithmetic.
4. Apply a camera filter to test texture inputs, frame lifetime and stream recording.

Separate compute examples could implement Game of Life or heat diffusion, then
an audio spectrogram. Simulations require explicit previous/next state buffers;
audio needs a host that meets its timing requirements. These are follow-up
experiments, not prerequisites for the first shader.

For each stage, retain reproducible inputs, expected results and commands.
Check selected pixel values against a CPU reference with documented tolerances,
as well as visual output, orientation and aspect ratio. Test unsupported source
diagnostics. Record compilation time and steady-state frame time separately;
label CPU/GPU timing and include readback or transfer costs where applicable.
Report the device, browser and adapter used before generalizing results to phones.
