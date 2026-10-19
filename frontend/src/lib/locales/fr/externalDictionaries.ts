import type { Catalog } from '@/lib/i18n'

/** French translations for external dictionary links in the word card. */
export const externalDictionariesMessages: Catalog = {
  Dictionaries: 'Dictionnaires',
  Customize: 'Personnaliser',
  Shown: 'Affichés',
  Available: 'Disponibles',
  'Move «{{name}}» up': 'Monter « {{name}} »',
  'Move «{{name}}» down': 'Descendre « {{name}} »',
  'Hide «{{name}}»': 'Masquer « {{name}} »',
  'Show «{{name}}»': 'Afficher « {{name}} »',
  'Edit «{{name}}»': 'Modifier « {{name}} »',
  '+ Add your own dictionary': '+ Ajouter votre propre dictionnaire',
  Link: 'Lien',
  'Replace the word in the link with {word}': 'Remplacez le mot dans le lien par {word}',
  'For all languages': 'Pour toutes les langues',
  'Delete dictionary': 'Supprimer le dictionnaire',
  'Delete «{{name}}» in all languages?': 'Supprimer « {{name}} » dans toutes les langues ?',
  'The link must start with http:// or https://': 'Le lien doit commencer par http:// ou https://',
  'Add {word} where the word goes': 'Ajoutez {word} à l’endroit où le mot doit figurer',
  'Curly braces other than {word} are not allowed':
    'Les accolades autres que {word} ne sont pas autorisées',
  '{word} cannot be part of the site address':
    '{word} ne peut pas faire partie de l’adresse du site',
  'The link is longer than 500 characters': 'Le lien dépasse 500 caractères',
  'No more than 30 custom dictionaries': '30 dictionnaires personnalisés au maximum',
}
