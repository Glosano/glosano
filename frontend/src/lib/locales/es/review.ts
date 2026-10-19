import { type Catalog, ctx } from '@/lib/i18n'

export const reviewMessages: Catalog = {
  'Could not recall': 'No lo recordé',
  'Recognized after reveal': 'Lo reconocí al ver la respuesta',
  'Almost recalled': 'Casi lo recordé',
  'Recalled with difficulty': 'Lo recordé con dificultad',
  Recalled: 'Lo recordé',
  'Recalled immediately': 'Lo recordé al instante',
  'Rate how easily you recalled the word.': 'Valora con qué facilidad has recordado la palabra.',
  'Your choice has been checked. Now rate how easily you recalled the word.':
    'Tu elección se ha comprobado. Ahora valora con qué facilidad has recordado la palabra.',
  'Finish session': 'Terminar la sesión',
  'Choose an activity': 'Elegir actividad',
  [ctx('title', 'Choose an activity')]: 'Selección de actividad',
  'Back to material results': 'Volver a los resultados del material',
  'Example from the material': 'Ejemplo del material',
  'AI-generated example': 'Ejemplo generado por AI',
  'AI translation of the example': 'Traducción AI del ejemplo',
  'AI feedback': 'Corrección de AI',
  'Translating the example…': 'Traduciendo el ejemplo…',
  'The example translation is unavailable. You can continue reviewing.':
    'La traducción del ejemplo no está disponible. Puedes seguir con el repaso.',
  'No saved translation': 'Sin traducción guardada',
  'This item is no longer available. Skip this exercise.':
    'Este elemento ya no está disponible. Omite este ejercicio.',
  'Mistakes from the previous session: {{count}} of {{total}} available.':
    'Errores de la sesión anterior: {{count}} de {{total}} disponibles.',
  'Answers saved': 'Respuestas guardadas',
  Skipped: 'Omitidas',
  Unanswered: 'Sin responder',
  Mistakes: 'Errores',
  'Moved to known': 'Pasadas a conocidas',
  'The last attempt is unconfirmed and is not included in these results.':
    'El último intento no está confirmado y no se incluye en estos resultados.',
  'The remaining mistakes are available in the next session.':
    'Los errores restantes estarán disponibles en la próxima sesión.',
  'Practise difficult words': 'Practicar las palabras difíciles',
  'These mistakes are no longer available for review.':
    'Estos errores ya no están disponibles para repasar.',
  'Fill in the word': 'Completar la palabra',
  'Extra practice — your review schedule stays the same.':
    'Práctica adicional: tu calendario de repasos no cambia.',
  'No words are available for this practice.': 'No hay palabras disponibles para esta práctica.',
  Attempts: 'Intentos',
  Matches: 'Aciertos',
  'With a hint': 'Con pista',
  'Difficult words: {{count}} of {{total}} available.':
    'Palabras difíciles: {{count}} de {{total}} disponibles.',
  'Enter the whole phrase': 'Escribe la frase completa',
  'Enter the missing word': 'Escribe la palabra que falta',
  Hint: 'Pista',
  'Correct!': '¡Correcto!',
  'This exercise practises a different word.': 'Este ejercicio practica otra palabra.',
  'Your answer: {{answer}}': 'Tu respuesta: {{answer}}',
  'Studied form: {{answer}}': 'Forma estudiada: {{answer}}',
  'Getting started': 'Primeros pasos',
  'Scheduled review': 'Repaso programado',
  'Review this material’s vocabulary': 'Repasar el vocabulario del material',
  'Extra practice': 'Práctica adicional',
  'Recall the meaning and reveal the answer': 'Recuerda el significado y muestra la respuesta',
  'Type the missing word or phrase': 'Escribe la palabra o frase que falta',
  'Available: {{total}} · This session: {{count}}':
    'Disponibles: {{total}} · En esta sesión: {{count}}',
  'Saved today: {{done}} of {{limit}} reviews.': 'Guardados hoy: {{done}} de {{limit}} repasos.',
  'Session size is limited by your remaining daily allowance.':
    'El tamaño de la sesión está limitado por lo que te queda del límite diario.',
  'The remaining vocabulary is available in later sessions.':
    'El resto del vocabulario estará disponible en próximas sesiones.',
  'Open flashcards': 'Abrir tarjetas',
  'Attempts: {{count}} · Skipped: {{skipped}} · Remaining: {{remaining}}':
    'Intentos: {{count}} · Omitidas: {{skipped}} · Restantes: {{remaining}}',
  Mistake: 'Error',
}
