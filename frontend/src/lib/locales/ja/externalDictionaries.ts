import type { Catalog } from '@/lib/i18n'

/** Japanese translations for external dictionary links in the word card. */
export const externalDictionariesMessages: Catalog = {
  Dictionaries: '辞書',
  Customize: 'カスタマイズ',
  Shown: '表示中',
  Available: '利用可能',
  'Move «{{name}}» up': '「{{name}}」を上へ',
  'Move «{{name}}» down': '「{{name}}」を下へ',
  'Hide «{{name}}»': '「{{name}}」を非表示',
  'Show «{{name}}»': '「{{name}}」を表示',
  'Edit «{{name}}»': '「{{name}}」を編集',
  '+ Add your own dictionary': '+ 独自の辞書を追加',
  Link: 'リンク',
  'Replace the word in the link with {word}': 'リンク内の単語を {word} に置き換えてください',
  'For all languages': 'すべての言語用',
  'Delete dictionary': '辞書を削除',
  'Delete «{{name}}» in all languages?': 'すべての言語から「{{name}}」を削除しますか？',
  'The link must start with http:// or https://':
    'リンクは http:// または https:// で始めてください',
  'Add {word} where the word goes': '単語が入る位置に {word} を追加してください',
  'Curly braces other than {word} are not allowed': '{word} 以外の波括弧は使用できません',
  '{word} cannot be part of the site address': '{word} はサイトのアドレスには使用できません',
  'The link is longer than 500 characters': 'リンクが500文字を超えています',
  'No more than 30 custom dictionaries': '独自の辞書は30件までです',
}
