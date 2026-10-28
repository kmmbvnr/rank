package com.arrrank.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.json.JSONObject;

/** Read-only bounded access to selected and downloaded program inputs. */
final class InputFiles {
    static File directory(Context context) throws Exception {
        File root = new File(context.getFilesDir(), "inputs");
        if (!root.isDirectory() && !root.mkdirs()) throw new IllegalStateException("Cannot create input storage");
        return root;
    }

    static WebResourceResponse serve(Context context, Uri uri) {
        try {
            String name = uri.getQueryParameter("name");
            if (name == null || !name.matches("[A-Za-z0-9_-]+")) throw new IllegalArgumentException("Invalid input file name");
            File file = new File(directory(context), name);
            if (!file.isFile()) throw new IllegalArgumentException("Input file not found");
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
                    throw new IllegalArgumentException("Invalid input file range");
                data = new byte[(int)Math.min(count, file.length() - offset)];
                try (RandomAccessFile stream = new RandomAccessFile(file, "r")) { stream.seek(offset); stream.readFully(data); }
                mime = "application/octet-stream";
            }
            return new WebResourceResponse(mime, null, 200, "OK",
                DebugSignalClient.addIsolationHeaders(Collections.singletonMap("Cache-Control", "no-store")), new ByteArrayInputStream(data));
        } catch (Exception error) {
            return new WebResourceResponse("text/plain", "UTF-8", 400, "Bad Request",
                DebugSignalClient.addIsolationHeaders(Collections.singletonMap("Cache-Control", "no-store")),
                new ByteArrayInputStream(error.toString().getBytes(StandardCharsets.UTF_8)));
        }
    }
}
