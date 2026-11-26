package de.baumaengel.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Öffnet eine gespeicherte Datei in der passenden App des Geräts, z. B. den PDF-Bericht in der
 * PDF-Anzeige. Ist keine Standard-App festgelegt, fragt Android selbst nach.
 *
 * Andere Apps dürfen nicht direkt auf den Dateipfad zugreifen, darum geht die Datei über den
 * FileProvider (AndroidManifest.xml, res/xml/file_paths.xml) mit einer Lese-Erlaubnis nur für diesen Aufruf.
 * Aufruf aus der App: siehe src/native.ts (openNativeFile).
 */
@CapacitorPlugin(name = "FileViewer")
public class FileViewerPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String path = call.getString("path");
        String mimeType = call.getString("mimeType", "*/*");
        if (path == null || path.isEmpty()) {
            call.reject("Keine Datei angegeben.");
            return;
        }
        // Kommt als "file:///storage/emulated/0/Documents/..." (Filesystem.getUri)
        String filePath = path.startsWith("file:") ? Uri.parse(path).getPath() : path;
        File file = new File(filePath);
        if (!file.exists()) {
            call.reject("Die Datei wurde nicht gefunden.");
            return;
        }

        Uri uri;
        try {
            uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        } catch (IllegalArgumentException e) {
            call.reject("Die Datei liegt an einem Ort, den die App nicht weitergeben darf.", e);
            return;
        }

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, mimeType);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Auf dem Gerät gibt es keine App, die diese Datei öffnen kann.");
        }
    }
}
