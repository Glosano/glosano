import type { Catalog } from '@/lib/i18n'

export const vocabImportMessages: Catalog = {
  'More actions': 'Weitere Aktionen',
  'Import from LingQ…': 'Aus LingQ importieren…',
  'Import from LingQ': 'Aus LingQ importieren',
  'Words and phrases go to your {{language}} vocabulary.':
    'Wörter und Phrasen werden zu Ihren Vokabeln ({{language}}) hinzugefügt.',
  'New import': 'Neuer Import',
  'By token (with levels)': 'Per Token (mit Stufen)',
  'CSV file': 'CSV-Datei',
  'Import LingQ tags': 'LingQ-Tags importieren',
  'Paste your LingQ API key.': 'Fügen Sie Ihren LingQ-API-Schlüssel ein.',
  'Sign in to LingQ and open the API key page':
    'Melden Sie sich bei LingQ an und öffnen Sie die Seite mit dem API-Schlüssel',
  'Copy the key and paste it here': 'Kopieren Sie den Schlüssel und fügen Sie ihn hier ein',
  'LingQ API key': 'LingQ-API-Schlüssel',
  'The key is used only for this import and is not saved.':
    'Der Schlüssel wird nur für diesen Import verwendet und nicht gespeichert.',
  'Words you marked as known while reading in LingQ are not transferred yet — only your LingQ cards.':
    'Wörter, die Sie beim Lesen in LingQ als bekannt markiert haben, werden noch nicht übernommen – nur Ihre LingQ-Karten.',
  'If a word is already in your vocabulary': 'Wenn ein Wort bereits in Ihren Vokabeln ist',
  'Keep its level': 'Stufe beibehalten',
  'Update from LingQ': 'Aus LingQ aktualisieren',
  'Start import': 'Import starten',
  'Choose a CSV file.': 'Wählen Sie eine CSV-Datei.',
  'A CSV export has no levels, review dates or known words. To transfer levels and review dates, use the token tab.':
    'Ein CSV-Export enthält keine Stufen, Wiederholungstermine oder bekannten Wörter. Um Stufen und Wiederholungstermine zu übernehmen, nutzen Sie den Token-Tab.',
  'Level for new words': 'Stufe für neue Wörter',
  'Studying, confidence {{value}}': 'Wird gelernt, Sicherheitsstufe {{value}}',
  'Importing…': 'Import läuft…',
  'Importing… {{done}} of {{total}}': 'Import läuft… {{done}} von {{total}}',
  'You can close this window — the import will continue.':
    'Sie können dieses Fenster schließen – der Import läuft weiter.',
  'Row {{row}}': 'Zeile {{row}}',
  'Import finished': 'Import abgeschlossen',
  'Added: {{words}} words, {{phrases}} phrases':
    'Hinzugefügt: Wörter – {{words}}, Phrasen – {{phrases}}',
  'Updated: {{value}}': 'Aktualisiert: {{value}}',
  'New known words: {{value}}': 'Neue bekannte Wörter: {{value}}',
  'Skipped: {{value}}': 'Übersprungen: {{value}}',
  'Show details': 'Details anzeigen',
  'and {{value}} more not shown': 'und {{value}} weitere, nicht angezeigt',
  'The import was interrupted. Start it again — nothing will be duplicated.':
    'Der Import wurde unterbrochen. Starten Sie ihn erneut – nichts wird doppelt angelegt.',
  'The import failed. Try again later.':
    'Der Import ist fehlgeschlagen. Versuchen Sie es später erneut.',
  'Lost connection to the server — the import status is unknown.':
    'Verbindung zum Server verloren – der Status des Imports ist unbekannt.',
  'Check again': 'Erneut prüfen',
  'An import is already running.': 'Es läuft bereits ein Import.',
  'Set your native language in the profile first.':
    'Legen Sie zuerst Ihre Muttersprache im Profil fest.',
  'The file is not a UTF-8 CSV.': 'Die Datei ist keine UTF-8-CSV-Datei.',
  'This does not look like a LingQ export: there is no "term" column.':
    'Das sieht nicht wie ein LingQ-Export aus: Es gibt keine Spalte „term“.',
  'The file looks damaged or is not a CSV export.':
    'Die Datei scheint beschädigt oder kein CSV-Export zu sein.',
  'The file has too many rows.': 'Die Datei hat zu viele Zeilen.',
  'The file is too large.': 'Die Datei ist zu groß.',
  'Choose a level for new words.': 'Wählen Sie eine Stufe für neue Wörter.',
  'The import was not found.': 'Der Import wurde nicht gefunden.',
  'LingQ rejected the key. Check it and try again.':
    'LingQ hat den Schlüssel abgelehnt. Prüfen Sie ihn und versuchen Sie es erneut.',
  'LingQ is unreachable from the server. Try again later.':
    'Der Server kann LingQ nicht erreichen. Versuchen Sie es später erneut.',
  'LingQ did not accept the request. Check the selected language.':
    'LingQ hat die Anfrage nicht angenommen. Prüfen Sie die gewählte Sprache.',
  'You have too many LingQ cards in this language to import by token.':
    'Sie haben in dieser Sprache zu viele LingQ-Karten für einen Import per Token.',
  'Empty term': 'Leerer Begriff',
  'Phrase is longer than 8 words': 'Die Phrase ist länger als 8 Wörter',
  'Term is longer than 256 characters': 'Der Begriff ist länger als 256 Zeichen',
  'Translation skipped: language not supported':
    'Übersetzung übersprungen: Sprache nicht unterstützt',
  'Translation is longer than 512 characters': 'Die Übersetzung ist länger als 512 Zeichen',
  'Tag is longer than 64 characters': 'Der Tag ist länger als 64 Zeichen',
  'Note is longer than 4000 characters': 'Die Notiz ist länger als 4000 Zeichen',
  'This row was skipped.': 'Diese Zeile wurde übersprungen.',
}
