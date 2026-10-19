import type { Catalog } from '@/lib/i18n'

export const importLessonMessages: Catalog = {
  File: 'Datei',
  'Import method': 'Importmethode',
  'Drop a file here': 'Datei hierher ziehen',
  'Choose file': 'Datei auswählen',
  'Choose one file.': 'Wählen Sie eine Datei aus.',
  'Choose a .txt or .md file.': 'Wählen Sie eine .txt- oder .md-Datei aus.',
  'Only .txt and .md files with text content are supported.':
    'Es werden nur .txt- und .md-Dateien mit Textinhalt unterstützt.',
  'The file must not exceed 5 MiB.': 'Die Datei darf 5 MiB nicht überschreiten.',
  'Save the file as UTF-8 and try again.':
    'Speichern Sie die Datei als UTF-8 und versuchen Sie es erneut.',
  'The file must contain non-empty text.': 'Die Datei muss Text enthalten.',
  'Upload a UTF-8 .txt or .md file, up to 5 MiB. Lesson language: {{language}}.':
    'Laden Sie eine .txt- oder .md-Datei in UTF-8 hoch, bis zu 5 MiB. Sprache der Lektion: {{language}}.',
  'Could not process the lesson. Close this window and try importing again.':
    'Die Lektion konnte nicht verarbeitet werden. Schließen Sie dieses Fenster und versuchen Sie den Import erneut.',
  'Processing lesson… You can close this window: the import will continue.':
    'Lektion wird verarbeitet… Sie können dieses Fenster schließen: Der Import läuft weiter.',
  'Check status': 'Status prüfen',
}
