package com.arrrank.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public class DebugSignalClientTest {

    @Test
    public void addIsolationHeadersToNull() {
        Map<String, String> headers = DebugSignalClient.addIsolationHeaders(null);
        assertNotNull(headers);
        assertEquals("same-origin", headers.get("Cross-Origin-Opener-Policy"));
        assertEquals("require-corp", headers.get("Cross-Origin-Embedder-Policy"));
        assertEquals("same-origin", headers.get("Cross-Origin-Resource-Policy"));
    }

    @Test
    public void addIsolationHeadersPreservesExisting() {
        Map<String, String> existing = Collections.singletonMap("Cache-Control", "no-store");
        Map<String, String> headers = DebugSignalClient.addIsolationHeaders(existing);
        assertEquals("no-store", headers.get("Cache-Control"));
        assertEquals("same-origin", headers.get("Cross-Origin-Opener-Policy"));
        assertEquals("require-corp", headers.get("Cross-Origin-Embedder-Policy"));
        assertEquals("same-origin", headers.get("Cross-Origin-Resource-Policy"));
    }

    @Test
    public void addIsolationHeadersOverridesConflicting() {
        Map<String, String> existing = new HashMap<>();
        existing.put("Cross-Origin-Opener-Policy", "unsafe-none");
        existing.put("Cross-Origin-Embedder-Policy", "unsafe-none");
        existing.put("Content-Type", "application/javascript");

        Map<String, String> headers = DebugSignalClient.addIsolationHeaders(existing);
        assertEquals("application/javascript", headers.get("Content-Type"));
        assertEquals("same-origin", headers.get("Cross-Origin-Opener-Policy"));
        assertEquals("require-corp", headers.get("Cross-Origin-Embedder-Policy"));
        assertEquals("same-origin", headers.get("Cross-Origin-Resource-Policy"));
    }
}
