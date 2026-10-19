import { type Catalog, ctx } from '@/lib/i18n'

export const reviewMessages: Catalog = {
  'Could not recall': 'Non retrouvé',
  'Recognized after reveal': 'Reconnu après la réponse',
  'Almost recalled': 'Presque retrouvé',
  'Recalled with difficulty': 'Retrouvé avec difficulté',
  Recalled: 'Retrouvé',
  'Recalled immediately': 'Retrouvé immédiatement',
  'Rate how easily you recalled the word.':
    'Évaluez avec quelle facilité vous avez retrouvé le mot.',
  'Your choice has been checked. Now rate how easily you recalled the word.':
    'Votre choix a été vérifié. Évaluez maintenant avec quelle facilité vous avez retrouvé le mot.',
  'Finish session': 'Terminer la séance',
  'Choose an activity': 'Choisir une activité',
  [ctx('title', 'Choose an activity')]: 'Choisissez une activité',
  'Back to material results': 'Retour aux résultats du contenu',
  'Example from the material': 'Exemple tiré du contenu',
  'AI-generated example': 'Exemple généré par AI',
  'AI translation of the example': 'Traduction AI de l’exemple',
  'AI feedback': 'Avis de l’AI',
  'Translating the example…': 'Traduction de l’exemple…',
  'The example translation is unavailable. You can continue reviewing.':
    'La traduction de l’exemple est indisponible. Vous pouvez poursuivre la révision.',
  'No saved translation': 'Aucune traduction enregistrée',
  'This item is no longer available. Skip this exercise.':
    'Cet élément n’est plus disponible. Passez cet exercice.',
  'Mistakes from the previous session: {{count}} of {{total}} available.':
    'Erreurs de la séance précédente : {{count}} sur {{total}} disponibles.',
  'Answers saved': 'Réponses enregistrées',
  Skipped: 'Passés',
  Unanswered: 'Sans réponse',
  Mistakes: 'Erreurs',
  'Moved to known': 'Passés en connus',
  'The last attempt is unconfirmed and is not included in these results.':
    'La dernière tentative n’est pas confirmée et n’est pas incluse dans ces résultats.',
  'The remaining mistakes are available in the next session.':
    'Les erreurs restantes sont disponibles lors de la prochaine séance.',
  'Practise difficult words': 'S’entraîner sur les mots difficiles',
  'These mistakes are no longer available for review.':
    'Ces erreurs ne sont plus disponibles pour la révision.',
  'Fill in the word': 'Compléter avec le mot',
  'Extra practice — your review schedule stays the same.':
    'Entraînement supplémentaire — votre calendrier de révision ne change pas.',
  'No words are available for this practice.': 'Aucun mot disponible pour cet entraînement.',
  Attempts: 'Tentatives',
  Matches: 'Correspondances',
  'With a hint': 'Avec indice',
  'Difficult words: {{count}} of {{total}} available.':
    'Mots difficiles : {{count}} sur {{total}} disponibles.',
  'Enter the whole phrase': 'Saisissez l’expression en entier',
  'Enter the missing word': 'Saisissez le mot manquant',
  Hint: 'Indice',
  'Correct!': 'Correct !',
  'This exercise practises a different word.': 'Cet exercice porte sur un autre mot.',
  'Your answer: {{answer}}': 'Votre réponse : {{answer}}',
  'Studied form: {{answer}}': 'Forme étudiée : {{answer}}',
  'Getting started': 'Découverte',
  'Scheduled review': 'Révision planifiée',
  'Review this material’s vocabulary': 'Réviser le vocabulaire du contenu',
  'Extra practice': 'Entraînement supplémentaire',
  'Recall the meaning and reveal the answer': 'Rappelez-vous le sens et affichez la réponse',
  'Type the missing word or phrase': 'Saisissez le mot ou l’expression manquants',
  'Available: {{total}} · This session: {{count}}':
    'Disponibles : {{total}} · Pendant la séance : {{count}}',
  'Saved today: {{done}} of {{limit}} reviews.':
    'Enregistrées aujourd’hui : {{done}} révisions sur {{limit}}.',
  'Session size is limited by your remaining daily allowance.':
    'La taille de la séance est limitée par votre quota quotidien restant.',
  'The remaining vocabulary is available in later sessions.':
    'Le reste du vocabulaire est disponible lors des prochaines séances.',
  'Open flashcards': 'Ouvrir les cartes mémoire',
  'Attempts: {{count}} · Skipped: {{skipped}} · Remaining: {{remaining}}':
    'Tentatives : {{count}} · Passées : {{skipped}} · Restantes : {{remaining}}',
  Mistake: 'Erreur',
}
