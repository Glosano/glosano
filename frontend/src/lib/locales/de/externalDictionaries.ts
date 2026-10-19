import type { Catalog } from '@/lib/i18n'

/** German translations for external dictionary links in the word card. */
export const externalDictionariesMessages: Catalog = {
  Dictionaries: 'Wörterbücher',
  Customize: 'Anpassen',
  Shown: 'Angezeigt',
  Available: 'Verfügbar',
  'Move «{{name}}» up': '„{{name}}“ nach oben verschieben',
  'Move «{{name}}» down': '„{{name}}“ nach unten verschieben',
  'Hide «{{name}}»': '„{{name}}“ ausblenden',
  'Show «{{name}}»': '„{{name}}“ anzeigen',
  'Edit «{{name}}»': '„{{name}}“ bearbeiten',
  '+ Add your own dictionary': '+ Eigenes Wörterbuch hinzufügen',
  Link: 'Link',
  'Replace the word in the link with {word}': 'Ersetzen Sie das Wort im Link durch {word}',
  'For all languages': 'Für alle Sprachen',
  'Delete dictionary': 'Wörterbuch löschen',
  'Delete «{{name}}» in all languages?': '„{{name}}“ in allen Sprachen löschen?',
  'The link must start with http:// or https://':
    'Der Link muss mit http:// oder https:// beginnen',
  'Add {word} where the word goes': 'Fügen Sie {word} an der Stelle des Wortes ein',
  'Curly braces other than {word} are not allowed':
    'Außer {word} sind keine geschweiften Klammern erlaubt',
  '{word} cannot be part of the site address': '{word} darf nicht Teil der Website-Adresse sein',
  'The link is longer than 500 characters': 'Der Link ist länger als 500 Zeichen',
  'No more than 30 custom dictionaries': 'Höchstens 30 eigene Wörterbücher',
}
