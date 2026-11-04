# Inkloop

Ein persönliches Lernheft als iPad-PWA: mit Apple Pencil schreiben, eine Lösung bewusst abgeben und mit dem eigenen ChatGPT- oder Claude-Chat weiterlernen. Dunkle Oberfläche mit Lernheftübersicht und einem Lernbereich für Aufgabe, Abschrift und Feedback.

## ChatGPT-Plugin (Version 1.1)

Inkloop stellt ein persönliches MCP-Plugin für ChatGPT bereit. Nach Aktivierung im Original-Chat kann ChatGPT Aufgaben senden, abgegebene Handschrift als Bild lesen und Transkription sowie Feedback direkt ins Lernheft zurückschreiben. Es nutzt dabei den bestehenden Chat und sein Modell; Inkloop ruft keine KI-API auf.

- App und Chat müssen mit demselben ChatGPT-Konto geöffnet sein. Die private Sites-Anmeldung sichert den Zugriff.
- In ChatGPT Inkloop als Plugin aktivieren. Danach z. B.: „Sende die nächste Aufgabe mit Inkloop in mein Lernheft.“
- Neu eingehende Aufgaben erhalten je eine eigene Seite. Die aktuelle Seite bleibt offen.
- Nach **Antwort abgeben** den Plugin-Auftrag in den bestehenden Chat kopieren oder ChatGPT auffordern, die neueste Inkloop-Abgabe zu lesen.
- Offline erstellte oder fehlgeschlagene Abgaben bleiben im Lernheft. In der Abgabenliste zeigt Inkloop den Sendestatus an und bietet **Erneut an ChatGPT senden** für dieselbe Abgabe an.
- Die Antwort wird bei geöffnetem Online-Lernheft automatisch abgeholt (alle sechs Sekunden und beim Zurückwechseln). Der Chat selbst wird nicht automatisch angeschrieben. Beim Eintreffen zeigt Inkloop einen Hinweis, Abschrift und Feedback stehen im Lernbereich. Nicht abgeholte Antworten und Aufgaben bleiben 90 Tage auf dem Server.
- Die Bridge speichert bewusst abgegebene PNGs, Aufgaben, Antworten und den Lernheftindex privat in R2, getrennt nach der von Sites bestätigten Nutzer-ID. Nicht abgegebene Handschrift bleibt lokal.
- Claude und Chats ohne aktiviertes Plugin verwenden die vollständige manuelle Bildübergabe. Eine Claude-MCP-Verbindung wurde nicht eingerichtet oder verifiziert.

## Benutzen

1. In Safari öffnen, dann **Teilen → Zum Home-Bildschirm**. Ab dann möglichst immer über dieses Symbol öffnen, damit dieselben lokalen Daten verwendet werden.
2. Optional vier Handschriftproben anlegen. Diese beschrifteten Beispiele werden auf Wunsch unter das Abgabebild gesetzt. Das ist eine Lesehilfe, kein Modelltraining und keine Genauigkeitsgarantie.
3. In der Lernheftübersicht ein Heft öffnen. Inkloop öffnet dessen letzte benutzte Seite. Im Hochformat öffnet sich der Lernbereich auf Abruf, im Querformat steht er neben der Schreibfläche. Aufgabe einfügen und mit Pencil oder Finger schreiben. Zwei Finger scrollen, ein waagrechter Wisch mit zwei Fingern blättert.
4. **Antwort abgeben** erstellt einen unveränderlichen Stand deiner Lösung und ein PNG auf weissem Hintergrund. Bild und Anweisung kopieren/teilen und im Original-Chat einfügen. Ein gespeicherter Chat-Link führt zu derselben Unterhaltung.
5. Die KI zuerst originalgetreu transkribieren und danach Feedback geben lassen. Ihren JSON-Codeblock unter **KI-Antwort übernehmen** einfügen. Abschrift, Feedback und nächste Aufgabe werden getrennt angezeigt. Normaler Text wird als Feedback gespeichert. Markdown, Tabellen und LaTeX werden unterstützt.
6. Regelmässig unter **Einstellungen → Sicherung laden** eine JSON-Sicherung herunterladen. Wiederherstellen ersetzt nach Bestätigung alle lokalen Daten. Auch Sicherungen über 40 MB können eingelesen werden.

## Bewusste Grenzen

- **Keine kostenpflichtigen KI-Aufrufe**, keine API-Schlüssel und kein Ersatzmodell. Die normalen Nachrichten-/Bildlimits des gewählten Chat-Abos gelten. Inkloop selbst transkribiert nichts automatisch.
- Eine PWA kann die Oberfläche und Kontodaten anderer Websites nicht auslesen. Die bestehende Chat-Unterhaltung bleibt im Originaldienst. Bild-/Textübertragung und Rückimport benötigen Nutzereingaben; automatisches Anschreiben oder Mitlesen beliebiger Original-Chats gehört nicht zu dieser Version. Über das aktivierte ChatGPT-Plugin werden gezielt übergebene Aufgaben und Antworten synchronisiert.
- Alle Lernhefte und Proben bleiben in IndexedDB auf diesem Gerät/in diesem Browser. Keine vollständige Cloud-Synchronisierung der Lernhefte; für das ChatGPT-Plugin werden gezielt Abgaben und Chat-Antworten serverseitig bereitgestellt. Gelöschte Website-Daten, Privatmodus oder Speicherdruck können Daten entfernen. Safari und Home-Bildschirm-App können getrennte Speicher haben.
- Das Lernheft funktioniert nach vollständigem ersten Laden auch offline. Der KI-Chat benötigt Internet. Die Service-Worker-Aktualisierung aktiviert sich nach dem Schliessen alter Inkloop-Fenster.
- Beim Löschen einer Seite kannst du zwischen lokalem Löschen und Löschen inklusive Serverkopien wählen. Die zweite Option entfernt auch Bilder und Rückmeldungen aus der Inkloop Bridge. Bereits in einen Chat übertragene Inhalte verwaltest du dort.
- Der Radierer löscht, was er berührt; Kritzeln über Schrift löscht bewusst nichts. Rückgängig/Wiederholen gilt für die Sitzung und die jeweilige Seite. Abgaben behalten ihre eigenen Strichkopien.
- Pencil-Druck wird aus Pointer Events übernommen. Handballeneingabe wird im Pencil-Modus ignoriert. Echtes Schreibgefühl und iPad-Clipboard/Share benötigen einen Gerätetest.

## Entwicklung

Node 22 oder neuer.

```sh
npm ci
npm run dev
npm test
npm run build
```

Die Web-App wird zunächst statisch in `dist/` gebaut. Der anschliessende Worker-Build bettet die Dateien in `dist/server/index.js` ein und stellt zusätzlich `/mcp` sowie die private `/api/bridge` bereit. Alle Ressourcen werden mit relativen Pfaden gebaut, sodass auch Hosting in einem Unterverzeichnis möglich ist. Die private Sites-Konfiguration liegt in `.openai/hosting.json` und enthält keine Geheimnisse.

## Architektur

- React + TypeScript + Vite, Lucide für Symbole. `App.tsx` orchestriert; Bibliothek, Lernbereich, Dialoge, Speicher- und Bridge-Hooks liegen in eigenen Modulen. `polish.css` enthält Bewegung und Feinschliff (Federkurven ohne Überschwingen, symmetrische Ein- und Ausgänge, Überblendungen bei reduzierter Bewegung).
- Eigene Canvas-Schreibfläche mit logischen 900 × 1200 Punkten, Pencil-Druck, Pointer Capture, gebündelten Pointer Events und Bildexport.
- IndexedDB-Speicherung mit einem Datensatz pro Seite: Gespeichert werden nur geänderte Seiten, atomar zusammen mit dem Index. Hat ein anderes Fenster dazwischen geschrieben, speichert Inkloop alles vollständig neu. Ältere Einzel-Datensätze werden beim ersten Laden migriert. Fehler sperren bestehende Daten vor einem versehentlichen Neustart; Änderungen anderer Fenster lösen einen Neuladehinweis aus.
- Wiederherstellung mit Formatprüfung, gültigen Chat-URLs und eindeutigen IDs.
- KI-Antworten als sicher gerendertes Markdown (kein HTML), GFM-Tabellen und KaTeX; Darstellung bei Bedarf nachgeladen.
- Keine Analytics, keine eigenen Login-Cookies (Anmeldung durch Sites), keine externen Schriften, keine eingebetteten Drittanbieter-Chats. Cloudflare R2 für die private Plugin-Bridge.

## Designreferenzen

[Apple Design](https://github.com/treemonsal/Kleiderschrank/blob/main/.claude/skills/apple-design/SKILL.md) und [Claude-Look der Kleiderschrank-App](https://github.com/treemonsal/Kleiderschrank/blob/main/design/CLAUDE_LOOK.md). Bewegung reduziert sich bei entsprechender Systemeinstellung; Transparenz und Kontrast berücksichtigen die Systemeinstellungen.

Das persönliche Inkloop-Plugin wurde von Sites erstellt; Plugin Management bestätigt es als bereits installiert. Aktiviere Inkloop im gewünschten ChatGPT-Chat. Eine Live-Tool-Ausführung aus genau diesem Chat konnte in der Entwicklungssitzung nicht verifiziert werden, weil die neu installierten Tools dort noch nicht im Werkzeugkatalog erschienen.
