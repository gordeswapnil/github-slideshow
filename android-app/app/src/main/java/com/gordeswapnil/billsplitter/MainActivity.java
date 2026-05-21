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
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.content.Intent;
import android.app.AlertDialog;
import android.content.DialogInterface;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

/**
 * Loads the bundled bill-splitter.html out of the app's assets and runs it
 * inside a WebView. localStorage is persisted to the app's private storage,
 * so bills never leave the device.
 *
 * The bundled HTML is served via {@link WebViewAssetLoader} at
 * https://appassets.androidplatform.net/assets/... rather than file:///,
 * because pages loaded from file:// silently fail to call cross-origin
 * HTTPS APIs (e.g. the Anthropic OCR endpoint) on most Android versions.
 * With a real HTTPS origin, fetch/XHR works as in a normal browser.
 */
public class MainActivity extends Activity {

    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final String ENTRY_URL  = APP_ORIGIN + "/assets/bill-splitter.html";

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> pendingFileChooser;
    private static final int FILE_CHOOSER_REQUEST = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                         // localStorage / sessionStorage
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, true);
        }

        webView.setWebViewClient(new WebViewClient() {
            // Serve the bundled HTML/CSS/JS via the asset loader on the
            // appassets.androidplatform.net origin. Anything else falls
            // through to the network.
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return assetLoader.shouldInterceptRequest(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri url = req.getUrl();
                String scheme = url.getScheme();
                String host   = url.getHost();
                if ("https".equals(scheme) && host != null) {
                    // Our own served pages and known CDN/API hosts stay in-app.
                    if (host.equals("appassets.androidplatform.net")
                            || host.endsWith("cdnjs.cloudflare.com")
                            || host.endsWith("cdn.jsdelivr.net")
                            || host.endsWith("api.anthropic.com")) {
                        return false;
                    }
                }
                if ("http".equals(scheme) || "https".equals(scheme)) {
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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            webView.setOnApplyWindowInsetsListener((v, insets) -> {
                int top    = insets.getInsets(WindowInsets.Type.systemBars()).top;
                int bottom = insets.getInsets(WindowInsets.Type.systemBars()).bottom;
                v.setPadding(0, top, 0, bottom);
                return insets;
            });
        }

        // JS ⇄ Java bridge for the Anthropic OCR call.
        webView.addJavascriptInterface(new WebAppInterface(webView), "HisaabNative");

        webView.loadUrl(ENTRY_URL);
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
