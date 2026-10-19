import type { Catalog } from '@/lib/i18n'

/** Russian translations for external dictionary links in the word card. */
export const externalDictionariesMessages: Catalog = {
  Dictionaries: 'Словари',
  Customize: 'Настроить',
  Shown: 'Показываются',
  Available: 'Доступные',
  'Move «{{name}}» up': 'Выше «{{name}}»',
  'Move «{{name}}» down': 'Ниже «{{name}}»',
  'Hide «{{name}}»': 'Скрыть «{{name}}»',
  'Show «{{name}}»': 'Показать «{{name}}»',
  'Edit «{{name}}»': 'Изменить «{{name}}»',
  '+ Add your own dictionary': '+ Добавить свой словарь',
  Link: 'Ссылка',
  'Replace the word in the link with {word}': 'Замените слово в ссылке на {word}',
  'For all languages': 'Для всех языков',
  'Delete dictionary': 'Удалить словарь',
  'Delete «{{name}}» in all languages?': 'Удалить «{{name}}» во всех языках?',
  'The link must start with http:// or https://': 'Ссылка должна начинаться с http:// или https://',
  'Add {word} where the word goes': 'Добавьте {word} на место слова',
  'Curly braces other than {word} are not allowed': 'Кроме {word}, фигурные скобки не допускаются',
  '{word} cannot be part of the site address': '{word} не может стоять в адресе сайта',
  'The link is longer than 500 characters': 'Ссылка длиннее 500 символов',
  'No more than 30 custom dictionaries': 'Не больше 30 своих словарей',
}
