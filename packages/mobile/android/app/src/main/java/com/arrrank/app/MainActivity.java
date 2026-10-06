package com.arrrank.app;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import android.os.Bundle;
import android.os.Build;
import android.graphics.Color;
import android.webkit.WebView;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import android.content.pm.PackageManager;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    private static WeakReference<MainActivity> currentActivity;
    private boolean resumed;
    private boolean keyboardRequested;
    private Boolean imeVisible;
    private int imeHeight;
    private int navigationHeight;

    public static MainActivity getCurrentActivity() {
        return currentActivity != null ? currentActivity.get() : null;
    }

    public boolean isAppResumed() {
        return resumed;
    }

    public static void pauseExecution() {
        MainActivity activity = getCurrentActivity();
        if (activity != null && activity.bridge != null) {
            WebView webView = activity.bridge.getWebView();
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript("window.rankPause && window.rankPause()", null));
            }
        }
    }

    public static void resumeExecution() {
        MainActivity activity = getCurrentActivity();
        if (activity != null && activity.bridge != null) {
            WebView webView = activity.bridge.getWebView();
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript("window.rankResume && window.rankResume()", null));
            }
        }
    }

    public static void stopExecution() {
        MainActivity activity = getCurrentActivity();
        if (activity != null && activity.bridge != null) {
            WebView webView = activity.bridge.getWebView();
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript("window.rankStop && window.rankStop()", null));
            }
        }
    }

    public void hideKeyboard() {
        keyboardRequested = true;
        getWindow().getDecorView().removeCallbacks(showKeyboard);
        if (bridge != null) WindowCompat.getInsetsController(getWindow(), bridge.getWebView())
            .hide(WindowInsetsCompat.Type.ime());
    }

    private final Runnable showKeyboard = () -> {
        if (!resumed || !hasWindowFocus() || keyboardRequested || bridge == null) return;
        WebView webView = bridge.getWebView();
        if (!webView.hasFocus()) webView.requestFocus();
        webView.evaluateJavascript(
            "window.rankShowKeyboard ? window.rankShowKeyboard() : false",
            focused -> {
                if (!resumed || !hasWindowFocus() || keyboardRequested) return;
                if ("true".equals(focused)) {
                    keyboardRequested = true;
                    WindowCompat.getInsetsController(getWindow(), webView)
                        .show(WindowInsetsCompat.Type.ime());
                } else scheduleKeyboard();
            });
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NotebooksPlugin.class);
        super.onCreate(savedInstanceState);
        currentActivity = new WeakReference<>(this);
        // Back closes an open notebook drawer or value viewer first; the page answers true when it took the press,
        // and only otherwise does Back do what it did before.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = bridge != null ? bridge.getWebView() : null;
                if (webView == null) {
                    passBackThrough();
                    return;
                }
                webView.evaluateJavascript("window.rankBack ? window.rankBack() : false", handled -> {
                    if (!"true".equals(handled)) passBackThrough();
                });
            }

            private void passBackThrough() {
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
        List<String> permissions = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(android.Manifest.permission.POST_NOTIFICATIONS);
            }
        }
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(android.Manifest.permission.RECORD_AUDIO);
        }
        if (!permissions.isEmpty()) {
            requestPermissions(permissions.toArray(new String[0]), 101);
        }
        bridge.setWebViewClient(new DebugSignalClient(bridge));
        getWindow().getDecorView().setBackgroundColor(Color.BLACK);
        hideSystemBars();
        reportKeyboard();
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    String background = String.format("#%06x", getColor(android.R.color.system_accent1_700) & 0xffffff);
                    String foreground = String.format("#%06x", getColor(android.R.color.system_accent1_100) & 0xffffff);
                    webView.evaluateJavascript("document.documentElement.style.setProperty('--run-background','" + background
                        + "');document.documentElement.style.setProperty('--run-foreground','" + foreground + "');", null);
                    // The symbol keyboard wears the same dynamic colors as the system keyboard.
                    webView.evaluateJavascript(color("--keyboard-900", android.R.color.system_neutral1_900)
                        + color("--keyboard-800", android.R.color.system_neutral1_800)
                        + color("--keyboard-700", android.R.color.system_neutral1_700)
                        + color("--key-foreground", android.R.color.system_neutral1_50)
                        + color("--keyboard-muted", android.R.color.system_neutral2_400)
                        + color("--keyboard-accent", android.R.color.system_accent1_200), null);
                }
                imeVisible = null;
                scheduleKeyboard();
            }
        });
    }

    private String color(String name, int id) {
        return String.format("document.documentElement.style.setProperty('%s','#%06x');", name, getColor(id) & 0xffffff);
    }

    /** The console shows its symbol keyboard only while the soft keyboard is closed. */
    private void reportKeyboard() {
        getWindow().getDecorView().getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            if (bridge == null) return;
            WebView webView = bridge.getWebView();
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
            if (insets == null) return;
            boolean visible = insets.isVisible(WindowInsetsCompat.Type.ime());
            // CSS pixels, so the symbol keyboard can take exactly the soft keyboard's place.
            int height = Math.round(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
                / getResources().getDisplayMetrics().density);
            // The system bars are hidden, yet the soft keyboard still keeps its bottom row clear of the gesture bar.
            int navigation = Math.round(insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.navigationBars()).bottom
                / getResources().getDisplayMetrics().density);
            if (imeVisible != null && imeVisible == visible && imeHeight == height && navigationHeight == navigation) return;
            imeVisible = visible;
            imeHeight = height;
            navigationHeight = navigation;
            webView.evaluateJavascript("window.rankSoftKeyboard&&window.rankSoftKeyboard("
                + visible + "," + height + "," + navigation + ")", null);
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        currentActivity = new WeakReference<>(this);
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
    public void onStop() {
        ExecutionService.onAppBackgrounded(this);
        super.onStop();
    }

    @Override
    public void onDestroy() {
        if (getCurrentActivity() == this) {
            currentActivity = null;
        }
        ExecutionService.stop(this);
        super.onDestroy();
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
