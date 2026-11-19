# Funkspur

Lokales WLAN-Site-Survey-Tool für Begehungen. Funkspur liest die Signalstärke
mehrerer Access Points als native dBm-Werte aus, speichert eine Auswahl am
Messort und zeichnet RSSI-Karten auf deinen Grundriss. Kein Konto, keine Cloud
und kein Hochladen von Grundrissen oder Messdaten.

## Live-Scan starten

| System | Start | Voraussetzungen |
| --- | --- | --- |
| Windows 10/11 | `start-windows.cmd` doppelklicken oder `py -3 run_funkspur.py` | Python 3.10+, WLAN-Adapter und Windows-WLAN-Dienst |
| Linux | `python3 run_funkspur.py` | Python 3.10+, WLAN-Adapter, `iw` und Scanrechte. Falls vorhanden, kann NetworkManager den Scan anstossen. |
| macOS oder ohne lokalen Scanner | `index.html` öffnen | Manueller Modus und CSV-Import, kein eingebauter WLAN-Scan |

Zuerst das Repo klonen oder auf GitHub **Code → Download ZIP** wählen
und entpacken. Der Launcher öffnet **http://127.0.0.1:8765/**. Wenn der
Port belegt ist, kannst du `python3 run_funkspur.py --port 8766`
verwenden, unter Windows mit `py -3` statt `python3`. Zum Beenden im
Terminal **Strg+C** drücken.

**Windows 11:** Meldet Funkspur fehlenden WLAN-Zugriff, prüfe
**Einstellungen → Datenschutz und Sicherheit → Standort**. Je nach
Windows-Version braucht der native WLAN-Scan Standortzugriff für
Desktop-Apps. Funkspur fragt keine GPS-Position ab. Ohne diese Freigabe
bleiben manuelle Messungen und CSV nutzbar. [Microsoft zur
Standortberechtigung für WLAN-APIs][windows-privacy]

## Eine Begehung durchführen

1. **Grundriss laden.** PNG, JPEG oder WebP importieren. Optional den
   Massstab mit zwei Punkten und der Entfernungsangabe setzen.
2. **Am Messort stehen bleiben.** Den Ort auf dem Grundriss anklicken,
   WLAN-Adapter wählen und **Scan am Messort** drücken. Funkspur wartet
   auf den Scan und übernimmt keine älteren Cache-Einträge. Die App
   verknüpft den Scan mit dem gewählten Punkt. Bewegst du den Punkt in
   der App während des Scans, musst du neu scannen.
3. **Radios auswählen.** Nach SSID/BSSID filtern und einzelne oder alle
   sichtbaren Radios auswählen. **Auswahl speichern** übernimmt nur
   die sichtbaren, ausgewählten Radios. RSSI, SSID, BSSID, Band, Kanal
   (falls bekannt), Zeitstempel und Messquelle bleiben den Einträgen
   zugeordnet. Danach den nächsten Ort messen.
4. **Ansicht wählen.** Einzelne BSSID anzeigen oder bei mehreren BSSIDs
   derselben SSID und desselben Bands das stärkste erfasste Radio pro
   Messort vergleichen. Karte und Zielwert prüfen. `-67 dBm` ist ein
   einstellbarer Startwert, kein pauschales Abnahmekriterium.
5. **Ergebnis sichern.** JSON speichert Grundriss, Massstab, Messreihe
   und Ansichtsoptionen. CSV exportiert die Rohmesspunkte. PNG
   exportiert die aktuelle Ansicht. Es gibt kein Autosave.

**Demo laden** zeigt eine fiktive Etage mit ausdrücklich markierten
synthetischen Werten. Der Live-Scan ist in diesem Demo-Projekt
deaktiviert. Zum Messen einen eigenen Grundriss laden.

## Messverfahren und Grenzen

- **Windows:** Die App wartet auf die Scan-Rückmeldung des Treibers,
  liest den nativen RSSI aus der Windows WLAN API und verwirft
  BSS-Einträge, deren Empfangszeit vor dem Start liegt.
- **Linux:** `iw` liefert RSSI in dBm und das Alter der BSS-Einträge.
  Funkspur verwendet nur Einträge mit bekanntem Alter, die während
  des Scan-Fensters gesehen wurden. Werte in Prozent oder auf einer
  Skala von 0 bis 100 werden nicht in dBm umgerechnet.
- **Heatmap:** Nummerierte Markierungen entsprechen Messwerten. Die Farbe
  dazwischen ist per inverser Distanzgewichtung (IDW) geschätzt. Sie bleibt
  innerhalb der von Messorten umschlossenen Fläche und benötigt pro
  Kartenpunkt mindestens drei verschiedene Messorte im gewählten Radius.
  Bei wiederholten Messungen desselben Radios am gleichen Ort nutzt die
  Interpolation deren Mittelwert. Die Ansicht „stärkstes gemessenes Radio“
  nutzt je exakter Position den höchsten erfassten RSSI im gewählten Band.
- **Interpretation:** Keine Messung bedeutet nicht kein Empfang. Die
  Kennzahl zum Zielwert zählt Messpunkte, nicht Quadratmeter. Wände und
  Materialdämpfung werden nicht modelliert. Funkspur prüft weder SNR noch
  Durchsatz, Kanalbelegung oder Roaming. Verwende für vergleichbare
  Ergebnisse denselben Client, Adapter und ähnliche Messbedingungen.
- **Lokal:** Der Dienst lauscht ausschliesslich auf `127.0.0.1`. Der
  Browser sendet weder Grundriss noch Koordinaten an den Scanner und
  exportiert nur auf Anfrage. Ein Grundriss pro Projekt. Exportdateien
  können Grundrisse und interne Funkdaten enthalten.

## Manuelle Messwerte und CSV

Wenn der Adapter keinen Vollscan erlaubt, kann der Linux-Helfer den RSSI des
**gerade verbundenen** Radios lesen. Pro Messort aufrufen:

```bash
iw dev
python3 tools/record_linux.py wlp2s0 begehung.csv --x 22.4 --y 48 --note "Büro 1"
```

Die Kenntnis der BSSID ist wichtig, wenn der Client zwischen APs wechselt.
Alternativ lassen sich dBm-Werte von einem separaten Messgerät eingeben.

CSV nutzt UTF-8, Komma als Trennzeichen und den Punkt als Dezimalzeichen.
X läuft von links nach rechts, Y von oben nach unten. Beide liegen zwischen
0 und 100 Prozent. Nur `x_pct`, `y_pct` und `rssi_dbm` sind Pflichtfelder.
Der Import hängt Zeilen an und dedupliziert nicht.

```csv
x_pct,y_pct,rssi_dbm,ssid,band,bssid,channel,note
22.4,48,-64,Beispiel,5 GHz,02:00:00:00:00:01,36,"Büro 1"
```

Beim Live-Scan kommen `observed_at` (UTC, ISO 8601 mit Millisekunden) und
`source` hinzu. Bestehende v0.1-Projektdateien bleiben lesbar.

## Tests

```bash
node --test tests/survey.test.cjs
python3 -m unittest discover -s tests
```

Für den optionalen Browser-Smoke-Test: Node-Playwright und Chromium.
Der Test benutzt einen expliziten synthetischen Adapter, kein echtes Funknetz.

```bash
CHROMIUM_PATH=/usr/bin/chromium node --test tests/browser-smoke.cjs
```

[windows-privacy]: https://learn.microsoft.com/windows/win32/nativewifi/wi-fi-access-location-changes
