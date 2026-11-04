package app.typealot.editor;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.WebView;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;

public class MainActivity extends BridgeActivity {
    @SuppressLint("WebViewApiAvailability")
    @Override
    protected void load() {
        PackageInfo provider;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            provider = WebView.getCurrentWebViewPackage();
        } else {
            provider = null;
        }
        var settings = CapConfig.loadDefault(this);
        int webViewVersion = 0;
        if (provider != null && provider.versionName != null) {
            try {
                webViewVersion = Integer.parseInt(provider.versionName.split("\\.")[0]);
            } catch (NumberFormatException ignored) {
                // An unknown engine cannot safely run the editor bundle.
            }
        }
        if (webViewVersion < settings.getMinWebViewVersion()) {
            new AlertDialog.Builder(this)
                .setTitle(R.string.webview_update_title)
                .setMessage(getString(R.string.webview_update_message, settings.getMinWebViewVersion()))
                .setPositiveButton(R.string.webview_settings, (dialog, which) -> {
                    Intent intent = provider == null
                        ? new Intent(Settings.ACTION_SETTINGS)
                        : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.fromParts("package", provider.packageName, null));
                    startActivity(intent);
                    finish();
                })
                .setNegativeButton(android.R.string.cancel, (dialog, which) -> finish())
                .setOnCancelListener(dialog -> finish())
                .show();
            return;
        }
        super.load();
    }
}
