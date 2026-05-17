package com.gordeswapnil.billsplitter;

import android.app.Activity;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.content.Intent;
import android.app.AlertDialog;
import android.content.DialogInterface;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

/**
 * Loads the bundled bill-splitter.html out of the app's assets and runs it
 * inside a WebView. The web app uses localStorage, which is persisted by
 * the WebView into the app's private storage on the phone — meaning the
 * user's bills never leave the device.
 */
public class MainActivity extends Activity {

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileChooser;
    private static final int FILE_CHOOSER_REQUEST = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                         // localStorage / sessionStorage
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);                          // we only load via file:///android_asset/
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);

        // Honour dark mode if the WebView build supports the new API
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest req) {
                Uri url = req.getUrl();
                String scheme = url.getScheme();
                // Keep in-app for file://android_asset, http/https for CDN-loaded libs.
                // Anything else (mailto:, tel:, intent:) hands off to the system.
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    // Allow only known asset libraries; everything else opens in browser.
                    String host = url.getHost();
                    if (host != null && (
                        host.endsWith("cdnjs.cloudflare.com") ||
                        host.endsWith("cdn.jsdelivr.net")     ||
                        host.endsWith("api.anthropic.com"))) {
                        return false; // load in WebView
                    }
                    Intent intent = new Intent(Intent.ACTION_VIEW, url);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams params) {
                if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
                pendingFileChooser = filePathCallback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    pendingFileChooser = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }
        });

        // Edge-to-edge friendly padding via system insets (API 30+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            webView.setOnApplyWindowInsetsListener((v, insets) -> {
                int top    = insets.getInsets(WindowInsets.Type.systemBars()).top;
                int bottom = insets.getInsets(WindowInsets.Type.systemBars()).bottom;
                v.setPadding(0, top, 0, bottom);
                return insets;
            });
        }

        webView.loadUrl("file:///android_asset/bill-splitter.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && pendingFileChooser != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    results = new Uri[n];
                    for (int i = 0; i < n; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    results = new Uri[]{ data.getData() };
                }
            }
            pendingFileChooser.onReceiveValue(results);
            pendingFileChooser = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            new AlertDialog.Builder(this)
                .setTitle("Quit Hisaab?")
                .setMessage("Your bills are saved on this device. You can come back anytime.")
                .setPositiveButton("Quit", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) { finish(); }
                })
                .setNegativeButton("Stay", null)
                .show();
        }
    }
}
