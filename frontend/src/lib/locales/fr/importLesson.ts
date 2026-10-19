import type { Catalog } from '@/lib/i18n'

export const importLessonMessages: Catalog = {
  File: 'Fichier',
  'Import method': 'Méthode d’importation',
  'Drop a file here': 'Déposez un fichier ici',
  'Choose file': 'Choisir un fichier',
  'Choose one file.': 'Choisissez un seul fichier.',
  'Choose a .txt or .md file.': 'Choisissez un fichier .txt ou .md.',
  'Only .txt and .md files with text content are supported.':
    'Seuls les fichiers .txt et .md contenant du texte sont pris en charge.',
  'The file must not exceed 5 MiB.': 'Le fichier ne doit pas dépasser 5 Mio.',
  'Save the file as UTF-8 and try again.': 'Enregistrez le fichier en UTF-8 et réessayez.',
  'The file must contain non-empty text.': 'Le fichier doit contenir du texte.',
  'Upload a UTF-8 .txt or .md file, up to 5 MiB. Lesson language: {{language}}.':
    'Importez un fichier .txt ou .md en UTF-8, jusqu’à 5 Mio. Langue de la leçon : {{language}}.',
  'Could not process the lesson. Close this window and try importing again.':
    'Impossible de traiter la leçon. Fermez cette fenêtre et réessayez l’importation.',
  'Processing lesson… You can close this window: the import will continue.':
    'Traitement de la leçon… Vous pouvez fermer cette fenêtre : l’importation se poursuivra.',
  'Check status': 'Vérifier l’état',
}
