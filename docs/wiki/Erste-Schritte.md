# Erste Schritte

1. **Ordner öffnen:** Einen Arbeitsordner für die Roboterprogramme in VS Code öffnen (**Datei → Ordner öffnen**).
2. **Programm anlegen:** Befehlspalette (`F1`) → **FANUC: Neues TP-Programm anlegen** → Namen eingeben. Es öffnet sich ein neues, noch ungespeichertes Listing mit `/PROG`, `/ATTR`, `/MN`, `/POS` und `/END`. Mit `Strg+S` als `NAME.LS` im Arbeitsordner speichern.

   Alternativ in einer leeren `.ls`-Datei das Snippet `prog` eingeben.
3. **Programmieren:** Im `/MN`-Block wird beim Zeilenumbruch automatisch die nächste Zeilennummer gesetzt. Befehle kommen über Snippets, z. B. `l` für eine Linearbewegung oder `seam` für einen kompletten Schweißbaustein (siehe [[Snippets und Zeilennummern]]).
4. **Fehler beheben:** Rote und gelbe Wellenlinien zeigen Probleme. Mit `Strg+.` gibt es Quick Fixes, alle Meldungen stehen unter **Probleme** (`Strg+Umschalt+M`). Details auf der Seite [[Syntaxprüfung]].
5. **Auf den Roboter laden:** In der Activity Bar auf das Roboter-Symbol klicken → **Controller hinzufügen** → IP-Adresse eingeben. Danach über den Wolken-Button in der Editor-Titelleiste hochladen (siehe [[Controller und FTP]]).

> Zum Ausprobieren liegt im Repository unter `examples/SCHWEISS1.LS` ein vollständiges Beispielprogramm.
