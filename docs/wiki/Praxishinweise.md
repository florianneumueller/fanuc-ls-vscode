# Praxishinweise zur Steuerung

- **FTP aktivieren:** `MENU → SETUP → Host Comm → FTP`. Der FTP-Server hat nur wenige Verbindungs-Slots. Hängt eine Sitzung, hilft meist ein Neustart des FTP-Servers im selben Menü.
- **Anmeldung:** Viele Steuerungen akzeptieren `anonymous` ohne Passwort. Ist ein Benutzer eingerichtet, das Passwort über **FANUC: Passwort hinterlegen** speichern.
- **Geräte:**
  - `md:` ist der Arbeitsspeicher, dort liegen die geladenen Programme.
  - `fr:` ist der FROM-Speicher.
  - `mc:` ist die Memory Card.
  - `ud1:` ist ein USB-Stick am Bedienteil.

  Die Liste ist je Controller frei konfigurierbar.
- **ASCII-Upload:** Ein `.ls` direkt nach `md:` zu schreiben, setzt die Option *ASCII Upload* (J537) voraus. Ohne diese Option das Listing z. B. auf `ud1:` ablegen und über das Teach Pendant laden, oder mit `.tp`-Binärdateien arbeiten. Die Extension lädt die Datei unverändert hoch; ob die Steuerung sie annimmt, entscheidet diese selbst.
- **Zeilennummern:** Vor jedem Upload einmal **FANUC: Zeilennummern neu nummerieren** ausführen. Das korrigiert auch `LINE_COUNT` und `MODIFIED`.
- **Zeilenenden:** LS-Dateien verwenden CRLF. Das ist für `.ls` voreingestellt. `trimTrailingWhitespace` ist bewusst aus, weil die Leerzeichen vor dem `;` zum Originalformat gehören.
- **Sicherung:** Vor größeren Änderungen per Rechtsklick auf `md:` → **Ganzes Gerät sichern** eine Kopie aller Programme ziehen.
