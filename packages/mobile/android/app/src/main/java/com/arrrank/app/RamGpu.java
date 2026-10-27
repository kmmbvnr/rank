package com.arrrank.app;

import android.content.Context;
import android.util.Base64;
import com.google.ai.edge.litert.Accelerator;
import com.google.ai.edge.litert.CompiledModel;
import com.google.ai.edge.litert.TensorBuffer;
import java.io.File;
import java.io.FileOutputStream;
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
        String nextKey = request.getString("model");
        boolean cached = nextKey.equals(key);
        if (!cached) {
            closeModel();
            File file = File.createTempFile("rank-ram-", ".tflite", context.getCacheDir());
            try {
                try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(Base64.decode(nextKey, Base64.DEFAULT)); }
                // GPU only: do not request CPU as a secondary accelerator.
                CompiledModel.Options options = new CompiledModel.Options(Accelerator.GPU);
                options.setGpuOptions(new CompiledModel.GpuOptions(null, null, null,
                    CompiledModel.GpuOptions.Precision.FP32, null, null, null, null,
                    null, null, null, null, null, null, null));
                model = CompiledModel.create(file.getAbsolutePath(), options);
                inputs = model.createInputBuffers(); outputs = model.createOutputBuffers();
                key = nextKey;
            } finally { file.delete(); }
        }
        long prepared = System.nanoTime();
        JSONArray data = request.getJSONArray("input");
        float[] input = new float[data.length()];
        for (int i = 0; i < input.length; i++) input[i] = (float) data.getDouble(i);
        inputs.get(0).writeFloat(input);
        model.run(inputs, outputs);
        float[] output = outputs.get(0).readFloat();
        JSONArray values = new JSONArray();
        for (float value : output) values.put((double) value);
        JSONObject result = new JSONObject(); result.put("output", values);
        // Kotlin 2.3.0 exposes no isFullyAccelerated query. Do not invent one:
        // full graph placement is verified with delegate logs in the device check.
        result.put("backend", "LiteRT GPU"); result.put("gpuOnlyRequested", true);
        result.put("cached", cached); result.put("prepareMs", (prepared - started) / 1e6);
        result.put("executeMs", (System.nanoTime() - prepared) / 1e6);
        return result;
    }

    private void closeModel() {
        if (inputs != null) for (TensorBuffer buffer : inputs) buffer.close();
        if (outputs != null) for (TensorBuffer buffer : outputs) buffer.close();
        if (model != null) model.close();
        inputs = null; outputs = null; model = null; key = null;
    }
    void close() { executor.submit(this::closeModel); executor.shutdown(); }
}
