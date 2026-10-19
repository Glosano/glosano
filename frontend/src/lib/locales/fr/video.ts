import { type Catalog, ctx } from '@/lib/i18n'

export const videoMessages: Catalog = {
  'Pressing Play connects your browser to YouTube.':
    'Appuyer sur Lecture connecte votre navigateur à YouTube.',
  'Processing lesson…': 'Traitement de la leçon…',
  'Video player': 'Lecteur vidéo',
  'Play fragment': 'Lire le fragment',
  'Replay fragment': 'Relire le fragment',
  Pause: 'Pause',
  'Creator captions': 'Sous-titres de l’auteur',
  'Automatic captions': 'Sous-titres automatiques',
  'Could not open the video. You can still study the text.':
    'Impossible d’ouvrir la vidéo. Vous pouvez tout de même étudier le texte.',
  'Open on YouTube': 'Ouvrir sur YouTube',
  'Your browser blocked playback. Press ▶ again.':
    'Votre navigateur a bloqué la lecture. Appuyez de nouveau sur ▶.',
  [ctx('video', 'Stop')]: 'Arrêter',
  'Play on turn': 'Lire au changement de page',
  'Advance automatically': 'Avancer automatiquement',
  'Page turning': 'Changement de page',
  More: 'Plus',
  'Pin video': 'Épingler la vidéo',
  'Shrink video': 'Réduire la vidéo',
  'New words on the page you leave become known. You can undo this.':
    'Les nouveaux mots de la page que vous quittez deviennent connus. Vous pouvez annuler cette action.',
  'New words in the fragment you leave become known. You can undo this.':
    'Les nouveaux mots du fragment que vous quittez deviennent connus. Vous pouvez annuler cette action.',
  'Saving page progress…': 'Enregistrement de la progression de la page…',
  'Saving fragment progress…': 'Enregistrement de la progression du fragment…',
  'Could not save the page. Retry saving, then press Play.':
    'Impossible d’enregistrer la page. Réessayez l’enregistrement, puis appuyez sur Lecture.',
  'Could not save the fragment. Retry saving, then press Play.':
    'Impossible d’enregistrer le fragment. Réessayez l’enregistrement, puis appuyez sur Lecture.',
  'Play from {{time}}': 'Lire à partir de {{time}}',
  'By fragment': 'Par fragment',
  'Previous fragment': 'Fragment précédent',
  'Next fragment': 'Fragment suivant',
  'YouTube link': 'Lien YouTube',
  Import: 'Importer',
  'Retry import': 'Réessayer l’importation',
  'Import the title and captions from YouTube. Language: {{language}}.':
    'Le titre et les sous-titres seront importés depuis YouTube. Langue : {{language}}.',
  'Prefer creator captions, then automatic captions in the same language.':
    'Les sous-titres de l’auteur sont préférés, puis les sous-titres automatiques dans la même langue.',
  'Could not reach YouTube. Try importing again.':
    'Impossible de joindre YouTube. Réessayez l’importation.',
  'YouTube blocked requests from this server. Try again later.':
    'YouTube a bloqué les requêtes de ce serveur. Réessayez plus tard.',
  'This video has no captions in your learning language.':
    'Cette vidéo n’a pas de sous-titres dans la langue que vous étudiez.',
  'Captions are unavailable for this video.':
    'Les sous-titres sont indisponibles pour cette vidéo.',
  'Video unavailable. Check the link and access to the video.':
    'Vidéo indisponible. Vérifiez le lien et l’accès à la vidéo.',
  'Could not retrieve the title. Check access to the video.':
    'Impossible de récupérer le titre. Vérifiez l’accès à la vidéo.',
  'Captions contain invalid text or timestamps.':
    'Les sous-titres contiennent du texte ou des horodatages non valides.',
  'Captions exceed the limit: 5 MiB, 20,000 cues or 6 hours.':
    'Les sous-titres dépassent la limite : 5 Mio, 20 000 répliques ou 6 heures.',
  'Import timed out. Try again.': 'Le délai d’importation est dépassé. Réessayez.',
  'Enter an HTTPS link to a single YouTube video.':
    'Saisissez un lien HTTPS vers une seule vidéo YouTube.',
  'Could not import this video. Try again later.':
    'Impossible d’importer cette vidéo. Réessayez plus tard.',
  'Edit text within each fragment. Timing and order stay the same.':
    'Modifiez le texte à l’intérieur de chaque fragment. Le minutage et l’ordre restent inchangés.',
  'Fragment {{number}} · {{range}}': 'Fragment {{number}} · {{range}}',
  'The material has changed or is still processing. Reload before saving.':
    'Le contenu a changé ou est encore en cours de traitement. Rechargez la page avant d’enregistrer.',
}
