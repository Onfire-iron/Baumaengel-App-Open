package de.baumaengel.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Eigene Erweiterungen müssen vor dem Start der Brücke angemeldet sein
        registerPlugin(GalleryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
