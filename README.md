# Inkloop

Ein persönliches Lernheft als iPad-PWA: mit Apple Pencil schreiben, eine Lösung bewusst abgeben und mit dem eigenen ChatGPT- oder Claude-Chat weiterlernen. Dunkles Design auf Basis der Apple-Design-Prinzipien und der Kleiderschrank-App.

## Benutzen

1. In Safari öffnen, dann **Teilen → Zum Home-Bildschirm**. Ab dann möglichst immer über dieses Symbol öffnen, damit dieselben lokalen Daten verwendet werden.
2. Optional vier Handschriftproben anlegen. Diese beschrifteten Beispiele werden auf Wunsch unter das Abgabebild gesetzt. Das ist eine Lesehilfe, kein Modelltraining und keine Genauigkeitsgarantie.
3. Lernheft öffnen, Aufgabe einfügen, mit Pencil schreiben. Finger scrollen standardmäßig; Fingereingabe ist in den Einstellungen aktivierbar.
4. **Antwort abgeben** erstellt einen unveränderlichen Stand deiner Lösung und ein PNG auf weißem Hintergrund. Bild und Anweisung kopieren/teilen und im Original-Chat einfügen. Ein gespeicherter Chat-Link führt zu derselben Unterhaltung.
5. Die KI zuerst originalgetreu transkribieren und danach Feedback geben lassen. Ihren JSON-Codeblock unter **KI-Antwort übernehmen** einfügen. Abschrift, Feedback und nächste Aufgabe werden getrennt angezeigt. Normaler Text wird als Feedback gespeichert. Markdown, Tabellen und LaTeX werden unterstützt.
6. Regelmäßig unter **Einstellungen → Sicherung laden** eine JSON-Sicherung herunterladen. Wiederherstellen ersetzt nach Bestätigung alle lokalen Daten.

## Bewusste Grenzen

- **Keine kostenpflichtigen KI-Aufrufe**, keine API-Schlüssel und kein Ersatzmodell. Die normalen Nachrichten-/Bildlimits des gewählten Chat-Abos gelten. Inkloop selbst transkribiert nichts automatisch.
- Eine PWA kann die Oberfläche und Kontodaten anderer Websites nicht auslesen. Die bestehende Chat-Unterhaltung bleibt im Originaldienst. Bild-/Textübertragung und Rückimport benötigen Nutzereingaben; automatische Synchronisierung gehört nicht zu dieser Version.
- Alle Lernhefte und Proben bleiben in IndexedDB auf diesem Gerät/in diesem Browser. Keine Cloud-Synchronisierung. Gelöschte Website-Daten, Privatmodus oder Speicherdruck können Daten entfernen. Safari und Home-Bildschirm-App können getrennte Speicher haben.
- Das Lernheft funktioniert nach vollständigem ersten Laden auch offline. Der KI-Chat benötigt Internet. Die Service-Worker-Aktualisierung aktiviert sich nach dem Schließen alter Inkloop-Fenster.
- Der Radierer löscht ganze Striche. Rückgängig/Wiederholen gilt für die Sitzung und die jeweilige Seite. Abgaben behalten ihre eigenen Strichkopien.
- Pencil-Druck wird aus Pointer Events übernommen. Handballeneingabe wird im Pencil-Modus ignoriert. Echtes Schreibgefühl und iPad-Clipboard/Share benötigen einen Gerätetest.

## Entwicklung

Node 22 oder neuer.

```sh
npm ci
npm run dev
npm test
npm run build
```

Statische Ausgabe: `dist/`. Alle Ressourcen werden mit relativen Pfaden gebaut, sodass auch Hosting in einem Unterverzeichnis möglich ist. Die private Sites-Konfiguration liegt in `.openai/hosting.json` und enthält keine Geheimnisse.

## Architektur

- React + TypeScript + Vite, Lucide für Symbole.
- Eigene Canvas-Schreibfläche mit logischen 900 × 1200 Punkten, Pencil-Druck, Pointer Capture, gebündelten Pointer Events und Bildexport.
- IndexedDB-Speicherung mit Transaktionsprüfung und serieller Schreibwarteschlange. Fehler sperren bestehende Daten vor einem versehentlichen Neustart; Änderungen anderer Fenster lösen einen Neuladehinweis aus.
- Wiederherstellung mit Formatprüfung, Größenlimits, gültigen Chat-URLs und eindeutigen IDs.
- KI-Antworten als sicher gerendertes Markdown (kein HTML), GFM-Tabellen und KaTeX; Darstellung bei Bedarf nachgeladen.
- Keine Analytics, keine Cookies von Inkloop, keine externen Schriften, keine eingebetteten Drittanbieter-Chats.

## Designreferenzen

[Apple Design](https://github.com/treemonsal/Kleiderschrank/blob/main/.claude/skills/apple-design/SKILL.md) und [Claude-Look der Kleiderschrank-App](https://github.com/treemonsal/Kleiderschrank/blob/main/design/CLAUDE_LOOK.md). Bewegung reduziert sich bei entsprechender Systemeinstellung; Transparenz und Kontrast berücksichtigen die Systemeinstellungen.
