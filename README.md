# Funkspur

Ein lokales Tool für die Auswertung einer WLAN-Begehung. Grundriss laden,
gemessene Signalstärke als dBm je Position erfassen und die Messreihe auf dem
Plan auswerten. Kein Konto, keine Abhängigkeiten im Browser, kein Upload von
Grundrissen oder Messdaten.

## Starten

Repository herunterladen oder klonen und **`index.html`** in einem aktuellen
Desktop-Browser öffnen. Falls der Browser lokale Skripte einschränkt, im
Projektordner `python3 -m http.server 8000 --bind 127.0.0.1` ausführen und
`http://127.0.0.1:8000` öffnen.

**Demo laden** öffnet eine fiktive Etage mit synthetischen RSSI-Werten. Der
Demodatensatz ist in der App, in der Projektdatei und im PNG-Export markiert.
Für eine echte Begehung einen eigenen Grundriss laden.

1. Einen PNG-, JPEG- oder WebP-Grundriss laden. Ein neues Bild ersetzt das
   aktuelle Projekt nach Bestätigung. Optional den Massstab über zwei
   bekannte Punkte und deren reale Distanz setzen.
2. Messort auf dem Plan anklicken, tatsächlich am Ort gemessenen RSSI (dBm)
   eintippen und Band, SSID, BSSID und Kanal ergänzen. Alternativ X/Y in
   Prozent eingeben oder Messwerte per CSV importieren.
3. Messreihe wählen und Radius prüfen. Die Kennzahl zum Zielwert zählt
   **Messpunkte**, nicht die abgedeckte Fläche. `-67 dBm` ist ein frei
   einstellbarer Startwert, kein Abnahmekriterium.
4. Projekt als JSON speichern, um es später samt Grundriss und Einstellungen
   wieder zu öffnen. CSV enthält alle Messpunkte, PNG die aktuelle Kartenansicht.
   Die App speichert nicht automatisch.

## Echte Messungen unter Linux

Der optionale Helfer braucht Python 3 und `iw`. Er liest das tatsächlich
empfangene Signal des momentan verbundenen Radios. Er scannt nicht nach
Nachbar-APs und erzeugt keinen künstlichen dBm-Wert.

```bash
iw dev
python3 tools/record_linux.py wlp2s0 begehung.csv --x 22.4 --y 48 --note "Büro 1"
```

Pro Messort wiederholen. Die Position entspricht X/Y im Plan. Kontrolliere
beim Begehen und nach einem Roaming-Wechsel die BSSID. Die App zeigt je
SSID, Band und BSSID eine separate Karte. Unter Windows oder macOS kannst du
dBm-Werte aus einem geeigneten Messgerät oder WLAN-Analyseprogramm manuell
erfassen oder im untenstehenden Format importieren. Prozentwerte der
Windows-Signalanzeige sind kein RSSI in dBm.

## CSV

Komma als Trennzeichen, Punkt als Dezimalzeichen, UTF-8. X läuft von links
nach rechts, Y von oben nach unten. Beide Koordinaten liegen zwischen 0 und
100 Prozent. Nur `x_pct`, `y_pct` und `rssi_dbm` sind Pflichtfelder.

```csv
x_pct,y_pct,rssi_dbm,ssid,band,bssid,channel,note
22.4,48,-64,Beispiel,5 GHz,02:00:00:00:00:01,36,"Büro 1"
```

Der Import hängt Zeilen an. Wenn deine CSV bereits importierte Messungen
enthält, importiere sie in ein neues Projekt, damit keine Duplikate entstehen.
Das Werkzeug maskiert formelartige Texte beim CSV-Export für Tabellenprogramme.

## Was die Karte aussagt

- Farbige nummerierte Punkte sind tatsächliche Eingabewerte. Die Farbfläche
  schätzt Zwischenwerte mit inverser quadratischer Distanzgewichtung (IDW).
  Sie bleibt innerhalb der konvexen Hülle der Messorte und braucht pro
  geschätztem Kartenpunkt mindestens drei unterschiedliche Messorte im
  gewählten Radius. Wiederholungen an exakt gleicher Position werden für
  die Interpolation gemittelt.
- Wände, Etagenübergänge und Materialien werden nicht modelliert. Die Karte
  ist keine prädiktive WLAN-Planung und kein Nachweis für SNR, Durchsatz,
  Kanalbelegung oder Roaming. Für echte Begehungen entlang von Türen,
  Korridoren und erwarteten Funkgrenzen dichter messen.
- Ohne BSSID landen Messpunkte derselben SSID und desselben Bands in
  derselben Messreihe. Für radio-spezifische Karten die BSSID erfassen.
- V0.1 verarbeitet einen Grundriss pro Projekt. Die Web-App kann nicht
  auf WLAN-Adapter zugreifen. Keine Cloud, kein Account, keine Telemetrie.
  Exportdateien können sensible Grundrisse und Gerätedaten enthalten.

## Tests

```bash
node --test tests/survey.test.cjs
python3 -m unittest discover -s tests
```
