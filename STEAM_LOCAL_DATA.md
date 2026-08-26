# Lokal aus Steam auslesbare Informationen

Stand: 26. August 2026

Diese Datei beschreibt den aktuellen Steam-Importer von PlayCounter. Gemeint sind Informationen, die lokal aus einer vorhandenen Steam-Installation gelesen werden. Der Importer verwendet dafür keine Steam Web API und meldet sich nicht bei Steam an.

## Steam-Installation

| Information | Lokale Quelle | Verwendung |
| --- | --- | --- |
| Ob Steam installiert ist | Windows-Registry und bekannte Standardverzeichnisse | Anzeige, ob ein Steam-Import möglich ist |
| Steam-Stammverzeichnis | `HKCU\Software\Valve\Steam\SteamPath`, ersatzweise `Program Files (x86)\Steam` oder `Program Files\Steam` | Ausgangspunkt für alle weiteren Dateien |
| Zusätzliche Steam-Bibliotheken | `steamapps/libraryfolders.vdf` | Auffinden von Spielen außerhalb des Steam-Stammverzeichnisses |

Der aktuelle native Scanner ist nur unter Windows aktiv.

## Lokale Steam-Konten

| Information | Lokale Quelle | Anmerkung |
| --- | --- | --- |
| Lokale Account-ID | Verzeichnisname unter `userdata/<accountId>` und aus der SteamID64 in `config/loginusers.vdf` abgeleitet | Entspricht dem unteren 32-Bit-Anteil der SteamID64 |
| Persona-Name | `PersonaName` in `config/loginusers.vdf` | Kann fehlen |
| Zuletzt verwendetes Konto | `MostRecent` in `config/loginusers.vdf` | Boolescher Hinweis von Steam |
| Anzahl Spiele mit lokaler Spielzeit | Aus `userdata/<accountId>/config/localconfig.vdf` gezählt | Dient zur Auswahl des passenden Kontos |

Die SteamID64 selbst wird derzeit nicht an die Desktop-Oberfläche weitergegeben. Es werden auch keine Passwörter, Login-Tokens oder Session-Cookies gelesen.

## Spiele eines Kontos

Für jeden Eintrag mit Spielzeit oder einem Zeitstempel können folgende Daten gelesen werden:

| Information | Lokale Quelle | Ergebnis im Importer |
| --- | --- | --- |
| Steam AppID | Schlüssel unter `UserLocalConfigStore/Software/Valve/Steam/apps` in `localconfig.vdf` | `externalId` |
| Synchronisierte Spielzeit | `Playtime` in `localconfig.vdf` | Minuten |
| Offline beziehungsweise getrennt aufgezeichnete Spielzeit | `PlaytimeDisconnected` in `localconfig.vdf` | Minuten |
| Gesamte importierbare Steam-Spielzeit | Summe aus `Playtime` und `PlaytimeDisconnected` | Im Desktop in Sekunden umgerechnet |
| Zuletzt gespielt | `LastPlayed` in `localconfig.vdf` | Unix-Zeitstempel, sofern vorhanden und größer als null |
| Spielname | Bevorzugt `name` aus `appmanifest_<AppID>.acf`, ersatzweise `common/name` aus `appcache/appinfo.vdf` | Anzeigename des Importkandidaten |

Spiele ohne Spielzeit und ohne `LastPlayed` werden durch den aktuellen Scanner nicht als Importkandidaten aufgenommen.

## Installationsstatus und Installationspfad

| Information | Lokale Quelle | Ergebnis im Importer |
| --- | --- | --- |
| Installationsverzeichnis laut Manifest | `installdir` in `steamapps/appmanifest_<AppID>.acf` | Mit Bibliothek und `steamapps/common` zum vollständigen Pfad zusammengesetzt |
| Tatsächlich lokal installiert | Der zusammengesetzte Installationspfad existiert als Verzeichnis | `installed: true` oder `false` |
| Vollständiger Installationspfad | Bibliothek + `steamapps/common` + `installdir` | `installPath` |

Der Manifeststatus `StateFlags` wird aktuell nicht ausgewertet. Der Installationsstatus wird ausschließlich über das Vorhandensein des berechneten Verzeichnisses bestimmt.

## Ausführbare Dateien installierter Spiele

Wenn ein Installationsverzeichnis vorhanden ist, durchsucht PlayCounter dieses lokal nach Windows-EXE-Dateien. Pro gefundener Datei sind verfügbar:

| Information | Herkunft |
| --- | --- |
| Dateiname | Dateiname der `.exe`, zum Beispiel `cs2.exe` |
| Relativer Pfad | Pfad relativ zum Installationsverzeichnis, zum Beispiel `game\bin\win64\cs2.exe` |
| Vollständiger Pfad | Kann eindeutig aus `installPath` und relativem Pfad zusammengesetzt werden |
| Dateigröße | Dateisystem-Metadaten in Bytes |
| Verzeichnistiefe | Tiefe relativ zum Installationsverzeichnis |


