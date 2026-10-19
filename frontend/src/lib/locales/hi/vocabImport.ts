import type { Catalog } from '@/lib/i18n'

export const vocabImportMessages: Catalog = {
  'More actions': 'और कार्रवाइयाँ',
  'Import from LingQ…': 'LingQ से इंपोर्ट करें…',
  'Import from LingQ': 'LingQ से इंपोर्ट करें',
  'Words and phrases go to your {{language}} vocabulary.':
    'शब्द और वाक्यांश आपकी शब्दावली ({{language}}) में जोड़े जाएँगे।',
  'New import': 'नया इंपोर्ट',
  'By token (with levels)': 'टोकन से (स्तरों के साथ)',
  'CSV file': 'CSV फ़ाइल',
  'Import LingQ tags': 'LingQ टैग इंपोर्ट करें',
  'Paste your LingQ API key.': 'अपनी LingQ API कुंजी पेस्ट करें।',
  'Sign in to LingQ and open the API key page': 'LingQ में लॉग इन करें और API कुंजी वाला पेज खोलें',
  'Copy the key and paste it here': 'कुंजी कॉपी करें और यहाँ पेस्ट करें',
  'LingQ API key': 'LingQ API कुंजी',
  'The key is used only for this import and is not saved.':
    'कुंजी केवल इसी इंपोर्ट के लिए इस्तेमाल होती है और सहेजी नहीं जाती।',
  'Words you marked as known while reading in LingQ are not transferred yet — only your LingQ cards.':
    'LingQ में पढ़ते समय ज्ञात चिह्नित किए गए शब्द अभी ट्रांसफ़र नहीं होते — सिर्फ़ आपके LingQ कार्ड।',
  'If a word is already in your vocabulary': 'अगर शब्द पहले से आपकी शब्दावली में है',
  'Keep its level': 'उसका स्तर वैसा ही रखें',
  'Update from LingQ': 'LingQ से अपडेट करें',
  'Start import': 'इंपोर्ट शुरू करें',
  'Choose a CSV file.': 'एक CSV फ़ाइल चुनें।',
  'A CSV export has no levels, review dates or known words. To transfer levels and review dates, use the token tab.':
    'CSV एक्सपोर्ट में स्तर, दोहराव की तारीखें और ज्ञात शब्द नहीं होते। स्तर और दोहराव की तारीखें ट्रांसफ़र करने के लिए टोकन वाला टैब इस्तेमाल करें।',
  'Level for new words': 'नए शब्दों का स्तर',
  'Studying, confidence {{value}}': 'सीखे जा रहे, विश्वास स्तर {{value}}',
  'Importing…': 'इंपोर्ट हो रहा है…',
  'Importing… {{done}} of {{total}}': 'इंपोर्ट हो रहा है… {{total}} में से {{done}}',
  'You can close this window — the import will continue.':
    'आप यह विंडो बंद कर सकते हैं — इंपोर्ट जारी रहेगा।',
  'Row {{row}}': 'पंक्ति {{row}}',
  'Import finished': 'इंपोर्ट पूरा हुआ',
  'Added: {{words}} words, {{phrases}} phrases':
    'जोड़े गए: शब्द — {{words}}, वाक्यांश — {{phrases}}',
  'Updated: {{value}}': 'अपडेट किए गए: {{value}}',
  'New known words: {{value}}': 'नए ज्ञात शब्द: {{value}}',
  'Skipped: {{value}}': 'छोड़े गए: {{value}}',
  'Show details': 'विवरण दिखाएँ',
  'and {{value}} more not shown': 'और {{value}} नहीं दिखाए गए',
  'The import was interrupted. Start it again — nothing will be duplicated.':
    'इंपोर्ट बीच में रुक गया। इसे फिर से शुरू करें — कुछ भी दोहराया नहीं जाएगा।',
  'The import failed. Try again later.': 'इंपोर्ट विफल रहा। बाद में फिर से कोशिश करें।',
  'Lost connection to the server — the import status is unknown.':
    'सर्वर से कनेक्शन टूट गया — इंपोर्ट की स्थिति अज्ञात है।',
  'Check again': 'फिर से जाँचें',
  'An import is already running.': 'एक इंपोर्ट पहले से चल रहा है।',
  'Set your native language in the profile first.': 'पहले प्रोफ़ाइल में अपनी मातृभाषा सेट करें।',
  'The file is not a UTF-8 CSV.': 'यह फ़ाइल UTF-8 CSV नहीं है।',
  'This does not look like a LingQ export: there is no "term" column.':
    'यह LingQ एक्सपोर्ट नहीं लगता: इसमें "term" कॉलम नहीं है।',
  'The file looks damaged or is not a CSV export.': 'फ़ाइल खराब लगती है या CSV एक्सपोर्ट नहीं है।',
  'The file has too many rows.': 'फ़ाइल में बहुत ज़्यादा पंक्तियाँ हैं।',
  'The file is too large.': 'फ़ाइल बहुत बड़ी है।',
  'Choose a level for new words.': 'नए शब्दों के लिए स्तर चुनें।',
  'The import was not found.': 'इंपोर्ट नहीं मिला।',
  'LingQ rejected the key. Check it and try again.':
    'LingQ ने कुंजी अस्वीकार कर दी। इसे जाँचें और फिर से कोशिश करें।',
  'LingQ is unreachable from the server. Try again later.':
    'सर्वर LingQ से कनेक्ट नहीं हो पा रहा। बाद में फिर से कोशिश करें।',
  'LingQ did not accept the request. Check the selected language.':
    'LingQ ने अनुरोध स्वीकार नहीं किया। चुनी गई भाषा जाँचें।',
  'You have too many LingQ cards in this language to import by token.':
    'इस भाषा में आपके LingQ कार्ड टोकन से इंपोर्ट करने के लिए बहुत ज़्यादा हैं।',
  'Empty term': 'खाली शब्द',
  'Phrase is longer than 8 words': 'वाक्यांश 8 शब्दों से लंबा है',
  'Term is longer than 256 characters': 'शब्द 256 अक्षरों से लंबा है',
  'Translation skipped: language not supported': 'अनुवाद छोड़ा गया: भाषा समर्थित नहीं है',
  'Translation is longer than 512 characters': 'अनुवाद 512 अक्षरों से लंबा है',
  'Tag is longer than 64 characters': 'टैग 64 अक्षरों से लंबा है',
  'Note is longer than 4000 characters': 'नोट 4000 अक्षरों से लंबा है',
  'This row was skipped.': 'यह पंक्ति छोड़ दी गई।',
}
