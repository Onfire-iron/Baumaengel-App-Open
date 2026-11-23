package de.baumaengel.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/**
 * Speichert ein Foto in die Galerie, in ein eigenes Album (Ordner "Bilder/<album>").
 *
 * Die Kamera-Erweiterung von Capacitor speichert fest nach DCIM, ohne eigenen Ordner. Ab Android 10
 * darf eine App über den MediaStore ohne Berechtigung Bilder in ihre eigenen Ordner legen.
 * Aufruf aus der App: siehe src/native.ts (saveToGallery).
 */
@CapacitorPlugin(name = "Gallery")
public class GalleryPlugin extends Plugin {

    @PluginMethod
    public void saveImage(PluginCall call) {
        String data = call.getString("data");
        String fileName = call.getString("fileName", "Foto.jpg");
        String album = call.getString("album", "Baumängel");
        if (data == null || data.isEmpty()) {
            call.reject("Keine Bilddaten erhalten.");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // Vor Android 10 bräuchte es eine Speicher-Berechtigung zur Laufzeit. Die Tablets sind neuer.
            call.reject("Speichern in ein eigenes Album geht erst ab Android 10.");
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + album);
        // Erst unsichtbar anlegen, damit die Galerie kein halb geschriebenes Bild zeigt
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            call.reject("Das Foto konnte nicht in die Galerie gelegt werden.");
            return;
        }
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new java.io.IOException("Kein Schreibzugriff auf die Galerie");
            out.write(Base64.decode(data, Base64.DEFAULT));
        } catch (Exception e) {
            resolver.delete(uri, null, null);
            call.reject("Das Foto konnte nicht in die Galerie geschrieben werden.", e);
            return;
        }
        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        call.resolve();
    }
}
