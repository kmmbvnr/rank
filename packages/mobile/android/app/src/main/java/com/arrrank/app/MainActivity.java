package com.arrrank.app;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import android.os.Bundle;
import android.graphics.Color;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    private boolean resumed;
    private boolean keyboardRequested;
    private final Runnable showKeyboard = () -> {
        if (!resumed || !hasWindowFocus() || keyboardRequested || bridge == null) return;
        WebView webView = bridge.getWebView();
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
        if (insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
            keyboardRequested = true;
            return;
        }
        if (!webView.hasFocus()) webView.requestFocus();
        webView.evaluateJavascript(
            "(function(){const input=document.getElementById('input');"
                + "if(!input)return false;"
                + "if(document.activeElement!==input)input.focus({preventScroll:true});return true;})()",
            focused -> {
                if (resumed && hasWindowFocus() && !keyboardRequested && "true".equals(focused)) {
                    keyboardRequested = true;
                    WindowCompat.getInsetsController(getWindow(), webView)
                        .show(WindowInsetsCompat.Type.ime());
                }
            });
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setBackgroundColor(Color.BLACK);
        hideSystemBars();
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) { scheduleKeyboard(); }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        resumed = true;
        keyboardRequested = false;
        scheduleKeyboard();
    }

    @Override
    public void onPause() {
        resumed = false;
        getWindow().getDecorView().removeCallbacks(showKeyboard);
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
            scheduleKeyboard();
        }
    }

    private void scheduleKeyboard() {
        if (!resumed || !hasWindowFocus() || keyboardRequested) return;
        getWindow().getDecorView().removeCallbacks(showKeyboard);
        getWindow().getDecorView().postDelayed(showKeyboard, 150);
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
