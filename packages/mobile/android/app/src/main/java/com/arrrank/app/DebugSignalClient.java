package com.arrrank.app;

import android.net.Uri;
import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/** Local-only signal mailbox for the synchronous interpreter worker. */
public final class DebugSignalClient extends BridgeWebViewClient {
    private String token;
    private final int[] words = new int[3];

    public DebugSignalClient(Bridge bridge) { super(bridge); }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!"https".equals(uri.getScheme()) || !"localhost".equals(uri.getHost()))
            return super.shouldInterceptRequest(view, request);
        if ("/__rank_haptic".equals(uri.getPath())) {
            String kind = uri.getQueryParameter("kind");
            int effect = "step".equals(kind)
                ? Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                    ? HapticFeedbackConstants.SEGMENT_FREQUENT_TICK : HapticFeedbackConstants.CLOCK_TICK
                : "hold".equals(kind) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
            view.post(() -> view.performHapticFeedback(effect));
            return response(200, "OK", "{}");
        }
        if (!"/__rank_debug".equals(uri.getPath())) return super.shouldInterceptRequest(view, request);
        // A bounded wait yields between worker polls without holding the mailbox lock.
        if ("1".equals(uri.getQueryParameter("wait"))) {
            try { Thread.sleep(20); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        return respond(uri);
    }

    private synchronized WebResourceResponse respond(Uri uri) {
        String key = uri.getQueryParameter("token");
        String control = uri.getQueryParameter("control");
        if (key == null || key.length() != 36) return response(400, "Bad Request", "[]");
        if ("reset".equals(control)) {
            token = key;
            words[0] = words[1] = words[2] = 0;
        }
        if (!key.equals(token)) return response(410, "Gone", "[]");
        if ("pause".equals(control)) words[1] = 1;
        else if ("stop".equals(control)) { words[0] = 1; words[1] = 0; }
        else if (control != null && control.matches("resume[0234]")) {
            words[2] = control.charAt(6) - '0';
            words[1] = 0;
        }
        String index = uri.getQueryParameter("index");
        String value = uri.getQueryParameter("value");
        if (index != null) {
            if (!index.matches("[012]") || value == null || !value.matches("[0-4]"))
                return response(400, "Bad Request", "[]");
            words[Integer.parseInt(index)] = Integer.parseInt(value);
        }
        return response(200, "OK", "[" + words[0] + "," + words[1] + "," + words[2] + "]");
    }

    private WebResourceResponse response(int status, String reason, String body) {
        return new WebResourceResponse("application/json", "UTF-8", status, reason,
            Collections.singletonMap("Cache-Control", "no-store"),
            new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }
}
