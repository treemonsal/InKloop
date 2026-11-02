# Produktentscheidungen

## Nutzungsrahmen

Eine Person, zuerst iPad. Deutsch und Englisch je Lernheft umschaltbar. Startfächer Mathematik, Finanz- und Rechnungswesen, Wirtschaft & Recht, frei erweiterbar. Keine zusätzlichen KI-Kosten.

## Handschrift bleibt die Quelle

Erkennung wird ausschließlich bewusst mit einer Abgabe angestoßen. Inkloop erzeugt das Bild, der bestehende Original-Chat erkennt die Handschrift. Eine Transkription darf fachliche Fehler nicht still korrigieren. Jede Abgabe speichert einen separaten Stand; späteres Radieren verändert keine ältere Abgabe.

## Referenzprofil

Vier Proben: Buchstabenverwechslungen, Ziffern, mathematische/finanzielle Zeichen und bilingualer Text. Vorgabetext und tatsächliche Handschrift sind zusammen im Export. Die Proben werden erst nach Abschluss des Tests ersetzt. Es wird kein eigenes Modell trainiert und keine verifizierte Erkennungsquote behauptet.

## Original-Chats statt API-Tutor

ChatGPT-/Claude-Abonnements werden nicht durch API-Schlüssel ersetzt. Keine Tokens oder Zugangsdaten im Client speichern. Kein fingierter OAuth-Login, keine unoffiziellen Session-Endpunkte, keine künstliche KI-Animation und kein vorgetäuschter synchronisierter Chat. Das Übergeben über Zwischenablage, Datei und Share Sheet ist sichtbar und explizit.

## Speicher und Verlustschutz

IndexedDB als lokale Quelle, serielle Transaktionen, Speichermeldung, Backup als JSON. Kein Fallback, der beim Ladefehler einen leeren Datensatz über vorhandene Daten schreibt. Mehrere Tabs erkennen konkurrierende Schreibvorgänge. Notizen werden nicht in Repository, Hosting-Artefakt oder URL gespeichert.

## Quellen für technische Grenzen

- https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
- https://support.claude.com/en/articles/9876003-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan
- https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy
