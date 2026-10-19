import type { Catalog } from '@/lib/i18n'

export const vocabImportMessages: Catalog = {
  'More actions': 'Plus d’actions',
  'Import from LingQ…': 'Importer depuis LingQ…',
  'Import from LingQ': 'Importer depuis LingQ',
  'Words and phrases go to your {{language}} vocabulary.':
    'Les mots et expressions sont ajoutés à votre vocabulaire ({{language}}).',
  'New import': 'Nouvelle importation',
  'By token (with levels)': 'Par jeton (avec niveaux)',
  'CSV file': 'Fichier CSV',
  'Import LingQ tags': 'Importer les étiquettes LingQ',
  'Paste your LingQ API key.': 'Collez votre clé d’API LingQ.',
  'Sign in to LingQ and open the API key page':
    'Connectez-vous à LingQ et ouvrez la page de la clé d’API',
  'Copy the key and paste it here': 'Copiez la clé et collez-la ici',
  'LingQ API key': 'Clé d’API LingQ',
  'The key is used only for this import and is not saved.':
    'La clé sert uniquement à cette importation et n’est pas enregistrée.',
  'Words you marked as known while reading in LingQ are not transferred yet — only your LingQ cards.':
    'Les mots marqués comme connus pendant la lecture sur LingQ ne sont pas encore transférés — seulement vos cartes LingQ.',
  'If a word is already in your vocabulary': 'Si un mot est déjà dans votre vocabulaire',
  'Keep its level': 'Conserver son niveau',
  'Update from LingQ': 'Mettre à jour depuis LingQ',
  'Start import': 'Lancer l’importation',
  'Choose a CSV file.': 'Choisissez un fichier CSV.',
  'A CSV export has no levels, review dates or known words. To transfer levels and review dates, use the token tab.':
    'Un export CSV ne contient ni niveaux, ni dates de révision, ni mots connus. Pour transférer les niveaux et les dates de révision, utilisez l’onglet par jeton.',
  'Level for new words': 'Niveau des nouveaux mots',
  'Studying, confidence {{value}}': 'En apprentissage, confiance {{value}}',
  'Importing…': 'Importation…',
  'Importing… {{done}} of {{total}}': 'Importation… {{done}} sur {{total}}',
  'You can close this window — the import will continue.':
    'Vous pouvez fermer cette fenêtre : l’importation continuera.',
  'Row {{row}}': 'Ligne {{row}}',
  'Import finished': 'Importation terminée',
  'Added: {{words}} words, {{phrases}} phrases':
    'Ajoutés : mots — {{words}}, expressions — {{phrases}}',
  'Updated: {{value}}': 'Mis à jour : {{value}}',
  'New known words: {{value}}': 'Nouveaux mots connus : {{value}}',
  'Skipped: {{value}}': 'Non importés : {{value}}',
  'Show details': 'Afficher les détails',
  'and {{value}} more not shown': 'et {{value}} autres non affichés',
  'The import was interrupted. Start it again — nothing will be duplicated.':
    'L’importation a été interrompue. Relancez-la : rien ne sera dupliqué.',
  'The import failed. Try again later.': 'L’importation a échoué. Réessayez plus tard.',
  'Lost connection to the server — the import status is unknown.':
    'Connexion au serveur perdue — l’état de l’importation est inconnu.',
  'Check again': 'Vérifier à nouveau',
  'An import is already running.': 'Une importation est déjà en cours.',
  'Set your native language in the profile first.':
    'Indiquez d’abord votre langue maternelle dans le profil.',
  'The file is not a UTF-8 CSV.': 'Le fichier n’est pas un CSV en UTF-8.',
  'This does not look like a LingQ export: there is no "term" column.':
    'Cela ne ressemble pas à un export LingQ : il n’y a pas de colonne « term ».',
  'The file looks damaged or is not a CSV export.':
    'Le fichier semble endommagé ou n’est pas un export CSV.',
  'The file has too many rows.': 'Le fichier contient trop de lignes.',
  'The file is too large.': 'Le fichier est trop volumineux.',
  'Choose a level for new words.': 'Choisissez un niveau pour les nouveaux mots.',
  'The import was not found.': 'Importation introuvable.',
  'LingQ rejected the key. Check it and try again.':
    'LingQ a refusé la clé. Vérifiez-la et réessayez.',
  'LingQ is unreachable from the server. Try again later.':
    'Le serveur ne parvient pas à joindre LingQ. Réessayez plus tard.',
  'LingQ did not accept the request. Check the selected language.':
    'LingQ n’a pas accepté la requête. Vérifiez la langue sélectionnée.',
  'You have too many LingQ cards in this language to import by token.':
    'Vous avez trop de cartes LingQ dans cette langue pour les importer par jeton.',
  'Empty term': 'Terme vide',
  'Phrase is longer than 8 words': 'L’expression dépasse 8 mots',
  'Term is longer than 256 characters': 'Le terme dépasse 256 caractères',
  'Translation skipped: language not supported': 'Traduction ignorée : langue non prise en charge',
  'Translation is longer than 512 characters': 'La traduction dépasse 512 caractères',
  'Tag is longer than 64 characters': 'L’étiquette dépasse 64 caractères',
  'Note is longer than 4000 characters': 'La note dépasse 4000 caractères',
  'This row was skipped.': 'Cette ligne n’a pas été importée.',
}
