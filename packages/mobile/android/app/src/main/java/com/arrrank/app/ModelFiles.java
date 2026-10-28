package com.arrrank.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.File;
import java.io.RandomAccessFile;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Read-only bounded access to imported checkpoint/model files in app storage. */
final class ModelFiles {
    static File resolve(Context context, String name) throws Exception {
        if (name == null || !name.matches("[A-Za-z0-9_-][A-Za-z0-9_./-]*") || name.contains(".."))
            throw new IllegalArgumentException("Invalid model file name");
        File root = new File(context.getFilesDir(), "models").getCanonicalFile();
        File file = new File(root, name).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator) || !file.isFile())
            throw new IllegalArgumentException("Model file not found");
        return file;
    }

    static WebResourceResponse serve(Context context, Uri uri) {
        try {
            File file = resolve(context, uri.getQueryParameter("name"));
            byte[] data;
            String mime;
            if ("stat".equals(uri.getQueryParameter("action"))) {
                data = new JSONObject().put("size", file.length()).put("revision", file.length() + ":" + file.lastModified())
                    .toString().getBytes(StandardCharsets.UTF_8);
                mime = "application/json";
            } else {
                long offset = Long.parseLong(uri.getQueryParameter("offset"));
                int count = Integer.parseInt(uri.getQueryParameter("count"));
                if (offset < 0 || offset > file.length() || count < 0 || count > 65536)
                    throw new IllegalArgumentException("Invalid model file range");
                data = new byte[(int)Math.min(count, file.length() - offset)];
                try (RandomAccessFile stream = new RandomAccessFile(file, "r")) {
                    stream.seek(offset); stream.readFully(data);
                }
                mime = "application/octet-stream";
            }
            return new WebResourceResponse(mime, null, 200, "OK",
                DebugSignalClient.addIsolationHeaders(java.util.Collections.singletonMap("Cache-Control", "no-store")), new ByteArrayInputStream(data));
        } catch (Exception error) {
            return new WebResourceResponse("text/plain", "UTF-8", 400, "Bad Request",
                DebugSignalClient.addIsolationHeaders(java.util.Collections.singletonMap("Cache-Control", "no-store")),
                new ByteArrayInputStream(error.toString().getBytes(StandardCharsets.UTF_8)));
        }
    }
}
