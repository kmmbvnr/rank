package com.arrrank.app;

import android.content.Context;
import android.util.Base64;
import com.google.ai.edge.litert.Accelerator;
import com.google.ai.edge.litert.CompiledModel;
import com.google.ai.edge.litert.TensorBuffer;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.security.MessageDigest;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** All GPU creation, execution and disposal use the same thread. One cached graph. */
final class RamGpu {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Context context;
    private String key;
    private CompiledModel model;
    private List<TensorBuffer> inputs;
    private int[] inputSizes;
    private List<TensorBuffer> outputs;

    RamGpu(Context context) { this.context = context.getApplicationContext(); }

    private final ConcurrentHashMap<String, CompletableFuture<String>> replies = new ConcurrentHashMap<>();

    private CompletableFuture<String> reply(String id) {
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid RAM request id");
        return replies.computeIfAbsent(id, ignored -> new CompletableFuture<>());
    }

    void submit(String id, String payload) {
        CompletableFuture<String> result = reply(id);
        executor.submit(() -> {
            try {
                if (payload == null || payload.length() > 32 * 1024 * 1024) throw new IllegalArgumentException("Invalid RAM request");
                result.complete(execute(new JSONObject(payload)).toString());
            } catch (Exception error) { result.complete(failure(error)); }
        });
    }

    String await(String id) {
        try { return reply(id).get(60, TimeUnit.SECONDS); }
        catch (Exception error) { return failure(error); }
        finally { if (id != null) replies.remove(id); }
    }

    private static String failure(Exception error) {
        JSONObject result = new JSONObject();
        try { result.put("error", "RAM GPU: " + error.toString()); }
        catch (Exception ignored) { }
        return result.toString();
    }

    private JSONObject execute(JSONObject request) throws Exception {
        long started = System.nanoTime();
        String action = request.getString("action");
        if (!action.equals("load") && !action.equals("invoke") && !action.equals("release"))
            throw new IllegalArgumentException("Unknown RAM action");
        if (action.equals("release")) {
            if (request.optString("modelId").equals(key)) closeModel();
            return new JSONObject().put("released", true);
        }
        boolean cached = action.equals("invoke");
        if (cached && (model == null || !request.optString("modelId").equals(key)))
            return new JSONObject().put("error", "RAM model is no longer loaded").put("code", "STALE_MODEL");
        if (!cached) {
            closeModel();
            if (request.has("model") == request.has("modelFile")) throw new IllegalArgumentException("Supply exactly one model source");
            boolean temporary = !request.has("modelFile");
            File file = temporary ? File.createTempFile("rank-ram-", ".tflite", context.getCacheDir())
                : ModelFiles.resolve(context, request.getJSONObject("modelFile").getString("path"));
            try {
                if (temporary) {
                    try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(Base64.decode(request.getString("model"), Base64.DEFAULT)); }
                } else {
                    JSONObject descriptor = request.getJSONObject("modelFile");
                    long size = file.length(), modified = file.lastModified();
                    if (size != descriptor.getLong("size")) throw new IllegalArgumentException("Model file size mismatch");
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");
                    byte[] chunk = new byte[1024 * 1024];
                    try (FileInputStream stream = new FileInputStream(file)) {
                        int count; while ((count = stream.read(chunk)) != -1) digest.update(chunk, 0, count);
                    }
                    StringBuilder hex = new StringBuilder();
                    for (byte b : digest.digest()) hex.append(String.format("%02x", b & 255));
                    if (!hex.toString().equals(descriptor.getString("sha256"))) throw new IllegalArgumentException("Model file checksum mismatch");
                    if (size != file.length() || modified != file.lastModified()) throw new IllegalArgumentException("Model file changed during verification");
                }
                // GPU only: do not request CPU as a secondary accelerator.
                CompiledModel.Options options = new CompiledModel.Options(Accelerator.GPU);
                options.setGpuOptions(new CompiledModel.GpuOptions(null, null, null,
                    CompiledModel.GpuOptions.Precision.FP32, null, null, null, null,
                    null, null, null, null, null, null, null));
                model = CompiledModel.create(file.getAbsolutePath(), options);
                inputs = model.createInputBuffers(); outputs = model.createOutputBuffers();
                JSONArray sizes = request.optJSONArray("inputSizes");
                if (sizes != null) {
                    if (sizes.length() != inputs.size()) throw new IllegalArgumentException("Wrong RAM input count");
                    inputSizes = new int[sizes.length()];
                    for (int i = 0; i < inputSizes.length; i++) {
                        inputSizes[i] = sizes.getInt(i);
                        if (inputSizes[i] < 1 || inputSizes[i] > 1048576)
                            throw new IllegalArgumentException("Invalid RAM input size");
                    }
                } else if (inputs.size() != 1) throw new IllegalArgumentException("Multiple RAM inputs require sizes");
                key = java.util.UUID.randomUUID().toString();
            } catch (Exception error) { closeModel(); throw error; } finally { if (temporary) file.delete(); }
        }
        if (action.equals("load")) return new JSONObject().put("modelId", key)
            .put("gpuOnlyRequested", true).put("prepareMs", (System.nanoTime() - started) / 1e6);
        long prepared = System.nanoTime();
        JSONArray data = request.getJSONArray("input");
        int[] sizes = inputSizes == null ? new int[] {data.length()} : inputSizes;
        JSONArray files = request.optJSONArray("inputFiles");
        if (files != null && (inputSizes == null || files.length() != sizes.length))
            throw new IllegalArgumentException("File inputs require declared input sizes");
        long total = 0;
        for (int i = 0; i < sizes.length; i++) if (files == null || files.isNull(i)) total += sizes[i];
        if (total != data.length()) throw new IllegalArgumentException("Wrong RAM input length");
        int offset = 0;
        for (int index = 0; index < sizes.length; index++) {
            if (files != null && !files.isNull(index)) {
                inputs.get(index).writeFloat(ModelFiles.readTensor(context, files.getJSONObject(index), sizes[index]));
                continue;
            }
            float[] input = new float[sizes[index]];
            for (int i = 0; i < input.length; i++) {
                input[i] = (float) data.getDouble(offset++);
                if (!Float.isFinite(input[i])) throw new IllegalArgumentException("RAM input requires finite f32 values");
            }
            inputs.get(index).writeFloat(input);
        }
        long written = System.nanoTime();
        model.run(inputs, outputs);
        long dispatched = System.nanoTime();
        float[] output = outputs.get(0).readFloat();
        long read = System.nanoTime();
        JSONArray values = new JSONArray();
        for (float value : output) values.put((double) value);
        long packed = System.nanoTime();
        JSONObject result = new JSONObject(); result.put("output", values);
        // Kotlin 2.3.0 exposes no isFullyAccelerated query. Do not invent one:
        // full graph placement is verified with delegate logs in the device check.
        result.put("backend", "LiteRT GPU"); result.put("gpuOnlyRequested", true);
        result.put("cached", cached); result.put("prepareMs", (prepared - started) / 1e6);
        result.put("executeMs", (System.nanoTime() - prepared) / 1e6);
        if (request.optBoolean("profile", false)) {
            result.put("inputMs", (written - prepared) / 1e6);
            result.put("dispatchMs", (dispatched - written) / 1e6);
            result.put("readbackMs", (read - dispatched) / 1e6);
            result.put("outputMs", (packed - read) / 1e6);
        }
        return result;
    }

    private void closeModel() {
        if (inputs != null) for (TensorBuffer buffer : inputs) buffer.close();
        if (outputs != null) for (TensorBuffer buffer : outputs) buffer.close();
        if (model != null) model.close();
        inputs = null; inputSizes = null; outputs = null; model = null; key = null;
    }
    void close() { executor.submit(this::closeModel); executor.shutdown(); }
}
