import type { Catalog } from '@/lib/i18n'

/** Hindi translations for external dictionary links in the word card. */
export const externalDictionariesMessages: Catalog = {
  Dictionaries: 'शब्दकोश',
  Customize: 'अनुकूलित करें',
  Shown: 'दिखाए जाते हैं',
  Available: 'उपलब्ध',
  'Move «{{name}}» up': '“{{name}}” को ऊपर ले जाएँ',
  'Move «{{name}}» down': '“{{name}}” को नीचे ले जाएँ',
  'Hide «{{name}}»': '“{{name}}” छिपाएँ',
  'Show «{{name}}»': '“{{name}}” दिखाएँ',
  'Edit «{{name}}»': '“{{name}}” संपादित करें',
  '+ Add your own dictionary': '+ अपना शब्दकोश जोड़ें',
  Link: 'लिंक',
  'Replace the word in the link with {word}': 'लिंक में शब्द की जगह {word} लिखें',
  'For all languages': 'सभी भाषाओं के लिए',
  'Delete dictionary': 'शब्दकोश हटाएँ',
  'Delete «{{name}}» in all languages?': 'सभी भाषाओं में “{{name}}” हटाएँ?',
  'The link must start with http:// or https://': 'लिंक http:// या https:// से शुरू होना चाहिए',
  'Add {word} where the word goes': 'जहाँ शब्द आना है, वहाँ {word} जोड़ें',
  'Curly braces other than {word} are not allowed':
    '{word} के अलावा कर्ली ब्रैकेट की अनुमति नहीं है',
  '{word} cannot be part of the site address': '{word} साइट के पते का हिस्सा नहीं हो सकता',
  'The link is longer than 500 characters': 'लिंक 500 अक्षरों से लंबा है',
  'No more than 30 custom dictionaries': 'अधिकतम 30 कस्टम शब्दकोश जोड़े जा सकते हैं',
}
