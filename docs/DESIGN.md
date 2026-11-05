# Gestaltung

Inkloop ist ein Werkzeug. Das Blatt ist der Inhalt, alles andere tritt zurück.

## Farbe

Dunkel, schwarz, grau, weiss und genau eine Akzentfarbe.

| Token                              | Wert                  | Rolle                                  |
| ---------------------------------- | --------------------- | -------------------------------------- |
| `--bg`                             | `#000000`             | Fläche hinter allem                    |
| `--paper`                          | `#121214`             | Blatt                                  |
| `--surface`                        | `#1c1c1e`             | Lernbereich, Seitenleiste, Dialoge     |
| `--raised`                         | `#2c2c2e`             | Felder, gedrückte und gewählte Flächen |
| `--text` / `--text-2` / `--text-3` | Weiss 100 / 60 / 32 % | Text in drei Stufen                    |
| `--accent`                         | `#0a84ff`             | Auswahl, aktives Werkzeug, Feedback    |
| `--danger`                         | `#ff453a`             | nur Fehler und Löschen                 |

Primäre Knöpfe sind weiss mit schwarzer Schrift. Der Akzent markiert Zustand, nie Dekoration. Die helle Darstellung tauscht nur die Tokens.

## Schrift

Systemschrift. Feste Stufen: 12, 13, 15, 16 (Lesetext), 17, 22, 34 px. Gewichte 400, 500, 600, 700. Keine Grossbuchstaben-Labels.

## Raster

Abstände 4, 8, 12, 16, 20, 24, 32. Rundungen: 10 (Felder), 14 (Gruppen, Karten), 22 (Dialoge, Leisten), rund (Werkzeuge, Pillen). Jede Bedienfläche misst mindestens 44 × 44 px. Symbole: Lucide, 20 px, Strich 1.75; in Knöpfen mit Text 18 px.

## Material

Eine einzige durchscheinende Schicht: die obere Leiste. Das Blatt läuft darunter durch. Lernbereich, Seitenleiste und Dialoge sind deckend, damit Aufgaben und Feedback lesbar bleiben. Bei reduzierter Transparenz wird die Leiste deckend.

## Bewegung

| Art        | Dauer  | Kurve                                          |
| ---------- | ------ | ---------------------------------------------- |
| Druck      | 100 ms | sofort beim Berühren                           |
| Zustand    | 180 ms | `--ease-out`                                   |
| Einblenden | 280 ms | `--ease-out` = `cubic-bezier(0.16, 1, 0.3, 1)` |
| Ausblenden | 200 ms | `--ease-in`                                    |

Was hereinkommt, geht auf demselben Weg hinaus. Seitenleiste und Lernbereich folgen beim Wischen dem Finger und entscheiden nach Geschwindigkeit. Übergänge sind unterbrechbar und blockieren keine Eingabe. Bei reduzierter Bewegung gibt es Überblendungen statt Bewegung.

## Zustände einer Abgabe

| Zustand                    | Bedeutung                         |
| -------------------------- | --------------------------------- |
| Lokal gespeichert          | nur auf diesem Gerät              |
| Abgegeben                  | an das ChatGPT-Plugin übertragen  |
| Übertragung fehlgeschlagen | erneut senden möglich             |
| Feedback erhalten          | Abschrift oder Feedback liegt vor |

Ein gespeicherter Chat-Link ist nur ein Link. Als verbunden gilt allein das erreichbare Plugin.

## Schreibfläche

Stiftdarstellung, Glättung nach der Schreibpause, Auswahlschutz und Zwei-Finger-Gesten liegen in `Canvas.tsx` und `ink.ts`. Gestaltungsarbeit ändert diese Dateien nicht und behält `touch-action: none` sowie `user-select: none` auf `.paper-scroll`, `.sample-surface` und der Leinwand.
