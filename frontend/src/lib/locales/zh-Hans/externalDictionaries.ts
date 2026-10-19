import type { Catalog } from '@/lib/i18n'

/** Simplified Chinese translations for external dictionary links in the word card. */
export const externalDictionariesMessages: Catalog = {
  Dictionaries: '词典',
  Customize: '自定义',
  Shown: '已显示',
  Available: '可添加',
  'Move «{{name}}» up': '将「{{name}}」上移',
  'Move «{{name}}» down': '将「{{name}}」下移',
  'Hide «{{name}}»': '隐藏「{{name}}」',
  'Show «{{name}}»': '显示「{{name}}」',
  'Edit «{{name}}»': '编辑「{{name}}」',
  '+ Add your own dictionary': '+ 添加自己的词典',
  Link: '链接',
  'Replace the word in the link with {word}': '请把链接中的单词替换为 {word}',
  'For all languages': '适用于所有语言',
  'Delete dictionary': '删除词典',
  'Delete «{{name}}» in all languages?': '要在所有语言中删除「{{name}}」吗？',
  'The link must start with http:// or https://': '链接必须以 http:// 或 https:// 开头',
  'Add {word} where the word goes': '请在单词所在位置添加 {word}',
  'Curly braces other than {word} are not allowed': '除 {word} 外，不允许使用花括号',
  '{word} cannot be part of the site address': '{word} 不能出现在网站地址中',
  'The link is longer than 500 characters': '链接超过 500 个字符',
  'No more than 30 custom dictionaries': '自定义词典最多 30 个',
}
