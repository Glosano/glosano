import type { Catalog } from '@/lib/i18n'

/** Spanish translations for external dictionary links in the word card. */
export const externalDictionariesMessages: Catalog = {
  Dictionaries: 'Diccionarios',
  Customize: 'Personalizar',
  Shown: 'Visibles',
  Available: 'Disponibles',
  'Move «{{name}}» up': 'Subir «{{name}}»',
  'Move «{{name}}» down': 'Bajar «{{name}}»',
  'Hide «{{name}}»': 'Ocultar «{{name}}»',
  'Show «{{name}}»': 'Mostrar «{{name}}»',
  'Edit «{{name}}»': 'Editar «{{name}}»',
  '+ Add your own dictionary': '+ Añadir tu propio diccionario',
  Link: 'Enlace',
  'Replace the word in the link with {word}': 'Sustituye la palabra del enlace por {word}',
  'For all languages': 'Para todos los idiomas',
  'Delete dictionary': 'Eliminar diccionario',
  'Delete «{{name}}» in all languages?': '¿Eliminar «{{name}}» en todos los idiomas?',
  'The link must start with http:// or https://': 'El enlace debe empezar por http:// o https://',
  'Add {word} where the word goes': 'Añade {word} donde va la palabra',
  'Curly braces other than {word} are not allowed': 'No se permiten llaves distintas de {word}',
  '{word} cannot be part of the site address':
    '{word} no puede formar parte de la dirección del sitio',
  'The link is longer than 500 characters': 'El enlace supera los 500 caracteres',
  'No more than 30 custom dictionaries': 'No más de 30 diccionarios propios',
}
