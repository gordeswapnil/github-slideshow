package com.gordeswapnil.billsplitter;

import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Tiny JavaScript ⇄ Java bridge that lets the bundled web app make HTTPS
 * calls to the Anthropic API without going through the WebView's fetch
 * stack. The WebView refuses cross-origin browser calls to api.anthropic.com
 * from the appassets.androidplatform.net origin (CORS preflight is rejected),
 * so the page hands the request to this bridge instead. The call is made
 * from a normal HttpURLConnection in Java — no CORS rules apply there.
 *
 * Exposed as `window.HisaabNative.callAnthropic(apiKey, bodyJson, callbackId)`.
 * On completion the bridge calls `window.HisaabBridge._resolve(callbackId, resultJson)`
 * on the WebView's UI thread. The result JSON shape is:
 *
 *   { "status": <http_status_code>, "body": "<response_body>" }
 *   { "status": -1, "error": "<message>" }   // network/exception path
 */
public class WebAppInterface {

    private static final String ENDPOINT = "https://api.anthropic.com/v1/messages";
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS    = 60000;

    private final WebView webView;
    private final Handler ui = new Handler(Looper.getMainLooper());

    public WebAppInterface(WebView webView) {
        this.webView = webView;
    }

    @JavascriptInterface
    public void callAnthropic(final String apiKey, final String body, final String callbackId) {
        new Thread(() -> {
            String result;
            HttpURLConnection conn = null;
            try {
                URL url = new URL(ENDPOINT);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type",     "application/json");
                conn.setRequestProperty("x-api-key",        apiKey);
                conn.setRequestProperty("anthropic-version","2023-06-01");
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setDoOutput(true);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes("UTF-8"));
                }
                int code = conn.getResponseCode();
                InputStream is = (code >= 200 && code < 300)
                        ? conn.getInputStream()
                        : conn.getErrorStream();
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                if (is != null) {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = is.read(buf)) > 0) baos.write(buf, 0, n);
                }
                JSONObject out = new JSONObject();
                out.put("status", code);
                out.put("body",   baos.toString("UTF-8"));
                result = out.toString();
            } catch (Exception e) {
                String msg = e.getMessage();
                if (msg == null) msg = e.getClass().getSimpleName();
                try {
                    JSONObject out = new JSONObject();
                    out.put("status", -1);
                    out.put("error",  msg);
                    result = out.toString();
                } catch (Exception ignored) {
                    result = "{\"status\":-1,\"error\":\"unknown\"}";
                }
            } finally {
                if (conn != null) conn.disconnect();
            }
            final String finalResult = result;
            ui.post(() -> {
                String js = "window.HisaabBridge && window.HisaabBridge._resolve("
                        + JSONObject.quote(callbackId) + ","
                        + JSONObject.quote(finalResult) + ")";
                webView.evaluateJavascript(js, null);
            });
        }, "HisaabAnthropicCall").start();
    }
}
