
package com.abdultransfer.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class MainActivity extends BridgeActivity {

    private static final int STORAGE_PERMISSION = 501;
    private TransferBridge transferBridge;
    private PendingTransfer pending;

    private static class PendingTransfer {
        String baseUrl;
        String code;
        String token;

        PendingTransfer(String b, String c, String t) {
            baseUrl = b;
            code = c;
            token = t;
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        transferBridge = new TransferBridge(this);
        webView.addJavascriptInterface(
            transferBridge,
            "AndroidMediaTransfer"
        );
    }

    private class TransferBridge {

        private final Activity activity;

        TransferBridge(Activity a) {
            activity = a;
        }

        @JavascriptInterface
        public void startTransfer(
            String baseUrl,
            String code,
            String senderToken
        ) {
            activity.runOnUiThread(() -> {
                if (!valid(baseUrl, code, senderToken)) {
                    report("error", "Aktarım bilgileri geçersiz.", 0);
                    return;
                }

                pending = new PendingTransfer(
                    baseUrl, code, senderToken
                );

                requestAccess();
            });
        }

        private boolean valid(String base, String code, String token) {
            try {
                Uri uri = Uri.parse(base);

                return "https".equals(uri.getScheme())
                    && "abdultransfer.onrender.com".equals(uri.getHost())
                    && code.matches("[0-9]{8}")
                    && token.matches("[a-fA-F0-9]{64}");
            } catch (Exception e) {
                return false;
            }
        }
    }

    private void requestAccess() {
        if (Build.VERSION.SDK_INT >= 30) {

            if (Environment.isExternalStorageManager()) {
                startScanning();
                return;
            }

            try {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + getPackageName())
                );
                startActivity(intent);
                report("status",
                    "Açılan Android ekranında AbdulTransfer için tüm dosyalara erişimi aç. Sonra uygulamaya geri dön.",
                    0);
            } catch (Exception e) {
                report("error",
                    "Android dosya erişim ayarları açılamadı.", 0);
            }

        } else if (Build.VERSION.SDK_INT >= 23) {

            if (checkSelfPermission(
                Manifest.permission.READ_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED) {
                startScanning();
            } else {
                requestPermissions(
                    new String[]{
                        Manifest.permission.READ_EXTERNAL_STORAGE
                    },
                    STORAGE_PERMISSION
                );
            }

        } else {
            startScanning();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();

        if (pending != null
            && Build.VERSION.SDK_INT >= 30
            && Environment.isExternalStorageManager()) {
            startScanning();
        }
    }

    @Override
    public void onRequestPermissionsResult(
        int requestCode,
        String[] permissions,
        int[] grantResults
    ) {
        super.onRequestPermissionsResult(
            requestCode, permissions, grantResults
        );

        if (requestCode == STORAGE_PERMISSION) {
            if (grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startScanning();
            } else {
                report("error",
                    "Depolama izni verilmedi.", 0);
                pending = null;
            }
        }
    }

    private synchronized void startScanning() {
        if (pending == null) return;

        PendingTransfer task = pending;
        pending = null;

        getWindow().addFlags(
            android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );

        new Thread(() -> {
            try {
                report("status", "Dosyalar taranıyor...", 0);

                File root = Environment.getExternalStorageDirectory();
                List<File> files = new ArrayList<>();

                scan(root, root, files);

                List<File> allowed = new ArrayList<>();
                long maxSize = 100L * 1024L * 1024L;

                for (File f : files) {
                    if (f.isFile() && f.canRead()
                        && f.length() <= maxSize) {
                        allowed.add(f);
                    }
                }

                if (allowed.isEmpty()) {
                    report("error",
                        "Aktarılabilecek dosya bulunamadı.", 0);
                    return;
                }

                report("status",
                    allowed.size() + " dosya bulundu. Aktarım başlıyor...",
                    0);

                int batchSize = 8;
                int completed = 0;

                for (int i = 0; i < allowed.size(); i += batchSize) {
                    int end = Math.min(i + batchSize, allowed.size());

                    List<File> batch = allowed.subList(i, end);

                    uploadBatch(task, batch);

                    completed = end;

                    int percent = (int)(
                        completed * 100.0 / allowed.size()
                    );

                    report("progress",
                        completed + " / " + allowed.size()
                            + " dosya gönderildi.",
                        percent);
                }

                report("done",
                    "Aktarım tamamlandı. " + completed
                        + " dosya gönderildi.",
                    100);

            } catch (Exception e) {
                report("error",
                    "Aktarım hatası: " + e.getMessage(), 0);
            } finally {
                runOnUiThread(() ->
                    getWindow().clearFlags(
                        android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                    )
                );
            }
        }).start();
    }

    private void scan(File root, File folder, List<File> result) {
        File[] items = folder.listFiles();
        if (items == null) return;

        for (File item : items) {
            String path = item.getAbsolutePath();

            // Android'in özel uygulama verilerine girme.
            if (item.isDirectory()) {
                if (path.contains("/Android/data")
                    || path.contains("/Android/obb")) {
                    continue;
                }

                scan(root, item, result);

            } else if (item.isFile() && item.canRead()) {
                result.add(item);
            }
        }
    }

    private void uploadBatch(
        PendingTransfer task,
        List<File> files
    ) throws Exception {

        String boundary = "----AbdulTransfer" + UUID.randomUUID();

        URL url = new URL(
            task.baseUrl + "/api/upload/" + task.code
        );

        HttpURLConnection connection =
            (HttpURLConnection) url.openConnection();

        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setConnectTimeout(30000);
        connection.setReadTimeout(120000);
        connection.setChunkedStreamingMode(64 * 1024);

        connection.setRequestProperty(
            "Authorization", "Bearer " + task.token
        );

        connection.setRequestProperty(
            "Content-Type",
            "multipart/form-data; boundary=" + boundary
        );

        try (DataOutputStream out =
            new DataOutputStream(connection.getOutputStream())) {

            byte[] buffer = new byte[64 * 1024];

            for (File file : files) {
                String name = file.getName()
                    .replace("\"", "_")
                    .replace("\r", "_")
                    .replace("\n", "_");

                String mime = URLConnection
                    .guessContentTypeFromName(name);

                if (mime == null) {
                    mime = "application/octet-stream";
                }

                out.writeBytes("--" + boundary + "\r\n");
                out.write(
                    ("Content-Disposition: form-data; name=\"files\"; filename=\""
                        + name + "\"\r\n").getBytes("UTF-8")
                );
                out.writeBytes("Content-Type: " + mime + "\r\n\r\n");

                try (InputStream in =
                    new BufferedInputStream(new FileInputStream(file))) {

                    int count;

                    while ((count = in.read(buffer)) != -1) {
                        out.write(buffer, 0, count);
                    }
                }

                out.writeBytes("\r\n");
            }

            out.writeBytes("--" + boundary + "--\r\n");
            out.flush();
        }

        int response = connection.getResponseCode();

        InputStream responseStream = response >= 400
            ? connection.getErrorStream()
            : connection.getInputStream();

        StringBuilder responseText = new StringBuilder();

        if (responseStream != null) {
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(responseStream, "UTF-8"))) {

                String line;
                while ((line = reader.readLine()) != null) {
                    responseText.append(line);
                }
            }
        }

        connection.disconnect();

        if (response < 200 || response >= 300) {
            throw new Exception(
                "Sunucu dosyaları kabul etmedi: " + response
            );
        }
    }

    private void report(String type, String message, int percent) {
        try {
            org.json.JSONObject data = new org.json.JSONObject();
            data.put("type", type);
            data.put("message", message);
            data.put("percent", percent);

            String js =
                "window.onNativeTransferProgress && "
                + "window.onNativeTransferProgress("
                + data.toString() + ");";

            runOnUiThread(() ->
                getBridge().getWebView().evaluateJavascript(js, null)
            );

        } catch (Exception ignored) {}
    }
}
