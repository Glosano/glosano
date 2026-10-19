import { type Catalog, ctx } from '@/lib/i18n'

export const videoMessages: Catalog = {
  'Pressing Play connects your browser to YouTube.':
    '▶ दबाने पर आपका ब्राउज़र YouTube से जुड़ जाएगा।',
  'Processing lesson…': 'पाठ प्रोसेस हो रहा है…',
  'Video player': 'वीडियो प्लेयर',
  'Play fragment': 'अंश चलाएँ',
  'Replay fragment': 'अंश फिर से चलाएँ',
  Pause: 'रोकें',
  'Creator captions': 'निर्माता के कैप्शन',
  'Automatic captions': 'स्वचालित कैप्शन',
  'Could not open the video. You can still study the text.':
    'वीडियो नहीं खुल सका। आप टेक्स्ट से अब भी सीख सकते हैं।',
  'Open on YouTube': 'YouTube पर खोलें',
  'Your browser blocked playback. Press ▶ again.':
    'आपके ब्राउज़र ने प्लेबैक रोक दिया। ▶ फिर से दबाएँ।',
  [ctx('video', 'Stop')]: 'बंद करें',
  'Play on turn': 'पृष्ठ पलटने पर चलाएँ',
  'Advance automatically': 'अपने-आप आगे बढ़ें',
  'Page turning': 'पृष्ठ पलटने का तरीका',
  More: 'और',
  'Pin video': 'वीडियो पिन करें',
  'Shrink video': 'वीडियो छोटा करें',
  'New words on the page you leave become known. You can undo this.':
    'जिस पृष्ठ को आप छोड़ते हैं, उसके नए शब्द ज्ञात हो जाते हैं। आप इसे वापस ले सकते हैं।',
  'New words in the fragment you leave become known. You can undo this.':
    'जिस अंश को आप छोड़ते हैं, उसके नए शब्द ज्ञात हो जाते हैं। आप इसे वापस ले सकते हैं।',
  'Saving page progress…': 'पृष्ठ की प्रगति सहेजी जा रही है…',
  'Saving fragment progress…': 'अंश की प्रगति सहेजी जा रही है…',
  'Could not save the page. Retry saving, then press Play.':
    'पृष्ठ सहेजा नहीं जा सका। फिर से सहेजने की कोशिश करें, फिर ▶ दबाएँ।',
  'Could not save the fragment. Retry saving, then press Play.':
    'अंश सहेजा नहीं जा सका। फिर से सहेजने की कोशिश करें, फिर ▶ दबाएँ।',
  'Play from {{time}}': '{{time}} से चलाएँ',
  'By fragment': 'अंश के अनुसार',
  'Previous fragment': 'पिछला अंश',
  'Next fragment': 'अगला अंश',
  'YouTube link': 'YouTube लिंक',
  Import: 'आयात करें',
  'Retry import': 'आयात फिर से करें',
  'Import the title and captions from YouTube. Language: {{language}}.':
    'YouTube से शीर्षक और कैप्शन आयात किए जाएँगे। भाषा: {{language}}।',
  'Prefer creator captions, then automatic captions in the same language.':
    'पहले निर्माता के कैप्शन लिए जाएँगे, फिर उसी भाषा के स्वचालित कैप्शन।',
  'Could not reach YouTube. Try importing again.':
    'YouTube से संपर्क नहीं हो सका। फिर से आयात करने की कोशिश करें।',
  'YouTube blocked requests from this server. Try again later.':
    'YouTube ने इस सर्वर के अनुरोध रोक दिए। कृपया बाद में कोशिश करें।',
  'This video has no captions in your learning language.':
    'इस वीडियो में आपकी सीखी जा रही भाषा के कैप्शन नहीं हैं।',
  'Captions are unavailable for this video.': 'इस वीडियो के लिए कैप्शन उपलब्ध नहीं हैं।',
  'Video unavailable. Check the link and access to the video.':
    'वीडियो उपलब्ध नहीं है। लिंक और वीडियो की पहुँच जाँचें।',
  'Could not retrieve the title. Check access to the video.':
    'शीर्षक नहीं मिल सका। वीडियो की पहुँच जाँचें।',
  'Captions contain invalid text or timestamps.': 'कैप्शन में अमान्य टेक्स्ट या टाइमस्टैंप हैं।',
  'Captions exceed the limit: 5 MiB, 20,000 cues or 6 hours.':
    'कैप्शन सीमा से अधिक हैं: 5 MiB, 20,000 कैप्शन खंड या 6 घंटे।',
  'Import timed out. Try again.': 'आयात में बहुत समय लगा। फिर से कोशिश करें।',
  'Enter an HTTPS link to a single YouTube video.':
    'किसी एक YouTube वीडियो का HTTPS लिंक दर्ज करें।',
  'Could not import this video. Try again later.':
    'यह वीडियो आयात नहीं किया जा सका। कृपया बाद में कोशिश करें।',
  'Edit text within each fragment. Timing and order stay the same.':
    'हर अंश के भीतर का टेक्स्ट संपादित करें। समय और क्रम नहीं बदलेंगे।',
  'Fragment {{number}} · {{range}}': 'अंश {{number}} · {{range}}',
  'The material has changed or is still processing. Reload before saving.':
    'सामग्री बदल गई है या अभी प्रोसेस हो रही है। सहेजने से पहले रीलोड करें।',
}
