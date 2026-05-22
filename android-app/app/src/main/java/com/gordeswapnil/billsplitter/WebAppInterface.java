package com.gordeswapnil.billsplitter;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * JavaScript ⇄ Java bridge exposed as `window.HisaabNative`.
 *
 * Provides three native capabilities the WebView cannot do on its own:
 *  1. callAnthropic   — HTTPS call to api.anthropic.com without CORS hassle
 *  2. saveToDownloads — write a file directly to the public Downloads folder
 *                       (MediaStore on Android 10+, public dir on older).
 *  3. shareFile       — drop the file in cache, hand to Android's share sheet
 *                       via FileProvider.
 *
 * For both file methods, JS passes base64 bytes; this class decodes and writes.
 */
public class WebAppInterface {

    private static final String ENDPOINT = "https://api.anthropic.com/v1/messages";
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS    = 60000;

    private final Activity activity;
    private final WebView webView;
    private final Handler ui = new Handler(Looper.getMainLooper());

    public WebAppInterface(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView  = webView;
    }

    // ===================================================================
    //                       Anthropic API bridge
    // ===================================================================

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
            postBridgeResolve(callbackId, result);
        }, "HisaabAnthropicCall").start();
    }

    // ===================================================================
    //                  Save to Downloads (MediaStore)
    // ===================================================================

    @JavascriptInterface
    public void saveToDownloads(final String filename, final String mimeType,
                                final String base64Data, final String callbackId) {
        new Thread(() -> {
            String result;
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    result = saveViaMediaStore(filename, mimeType, bytes);
                } else {
                    result = saveViaLegacyExternal(filename, bytes);
                }
            } catch (Exception e) {
                String msg = e.getMessage();
                if (msg == null) msg = e.getClass().getSimpleName();
                try {
                    JSONObject out = new JSONObject();
                    out.put("ok",    false);
                    out.put("error", msg);
                    result = out.toString();
                } catch (Exception ignored) {
                    result = "{\"ok\":false,\"error\":\"unknown\"}";
                }
            }
            final String fin = result;
            ui.post(() -> {
                try {
                    JSONObject j = new JSONObject(fin);
                    if (j.optBoolean("ok")) {
                        Toast.makeText(activity, "Saved to Downloads/" + filename, Toast.LENGTH_LONG).show();
                    } else {
                        Toast.makeText(activity, "Save failed: " + j.optString("error"), Toast.LENGTH_LONG).show();
                    }
                } catch (Exception ignored) {}
                postBridgeResolve(callbackId, fin);
            });
        }, "HisaabSaveToDownloads").start();
    }

    @SuppressWarnings("InlinedApi")
    private String saveViaMediaStore(String filename, String mimeType, byte[] bytes) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME,   filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE,      mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH,  Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.MediaColumns.IS_PENDING,     1);
        Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        Uri uri = activity.getContentResolver().insert(collection, values);
        if (uri == null) throw new Exception("MediaStore insert returned null");
        try (OutputStream out = activity.getContentResolver().openOutputStream(uri)) {
            if (out == null) throw new Exception("Could not open output stream");
            out.write(bytes);
        }
        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        activity.getContentResolver().update(uri, values, null, null);
        JSONObject out = new JSONObject();
        out.put("ok",   true);
        out.put("path", "Downloads/" + filename);
        out.put("uri",  uri.toString());
        return out.toString();
    }

    private String saveViaLegacyExternal(String filename, byte[] bytes) throws Exception {
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!downloads.exists()) downloads.mkdirs();
        File outFile = new File(downloads, filename);
        try (FileOutputStream out = new FileOutputStream(outFile)) {
            out.write(bytes);
        }
        JSONObject out = new JSONObject();
        out.put("ok",   true);
        out.put("path", outFile.getAbsolutePath());
        return out.toString();
    }

    // ===================================================================
    //                     Share file (Android share sheet)
    // ===================================================================

    @JavascriptInterface
    public void shareFile(final String filename, final String mimeType, final String base64Data) {
        ui.post(() -> {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                File shareDir = new File(activity.getCacheDir(), "share");
                if (!shareDir.exists()) shareDir.mkdirs();
                String safeName = filename.replaceAll("[/\\\\]", "_");
                File outFile = new File(shareDir, safeName);
                try (FileOutputStream out = new FileOutputStream(outFile)) {
                    out.write(bytes);
                }
                String authority = activity.getPackageName() + ".fileprovider";
                Uri uri = FileProvider.getUriForFile(activity, authority, outFile);
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType(mimeType);
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.putExtra(Intent.EXTRA_SUBJECT, safeName);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(intent, "Share " + safeName);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(chooser);
            } catch (Exception e) {
                String msg = e.getMessage();
                if (msg == null) msg = e.getClass().getSimpleName();
                Toast.makeText(activity, "Share failed: " + msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    @JavascriptInterface
    public void shareText(final String text, final String subject) {
        ui.post(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("text/plain");
                intent.putExtra(Intent.EXTRA_TEXT, text);
                if (subject != null && subject.length() > 0) {
                    intent.putExtra(Intent.EXTRA_SUBJECT, subject);
                }
                Intent chooser = Intent.createChooser(intent, "Share via");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(chooser);
            } catch (Exception e) {
                Toast.makeText(activity, "Share failed", Toast.LENGTH_LONG).show();
            }
        });
    }

    // ===================================================================
    //                       Bridge resolver helper
    // ===================================================================

    private void postBridgeResolve(String callbackId, String resultJson) {
        if (callbackId == null || callbackId.isEmpty()) return;
        ui.post(() -> {
            String js = "window.HisaabBridge && window.HisaabBridge._resolve("
                    + JSONObject.quote(callbackId) + ","
                    + JSONObject.quote(resultJson) + ")";
            webView.evaluateJavascript(js, null);
        });
    }
}
