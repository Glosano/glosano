import { type Catalog, ctx } from '@/lib/i18n'

export const videoMessages: Catalog = {
  'Pressing Play connects your browser to YouTube.':
    'При нажатии Play браузер подключится к YouTube.',
  'Processing lesson…': 'Обработка урока…',
  'Video player': 'Видеоплеер',
  'Play fragment': 'Воспроизвести фрагмент',
  'Replay fragment': 'Повторить фрагмент',
  Pause: 'Пауза',
  'Creator captions': 'Авторские субтитры',
  'Automatic captions': 'Автоматические субтитры',
  'Could not open the video. You can still study the text.':
    'Не удалось открыть видео. Текст доступен для изучения.',
  'Open on YouTube': 'Открыть на YouTube',
  'Your browser blocked playback. Press ▶ again.': 'Браузер остановил запуск. Нажмите ▶ ещё раз.',
  [ctx('video', 'Stop')]: 'Стоп',
  'Play on turn': 'Играть при листании',
  'Advance automatically': 'Листать автоматически',
  'Page turning': 'Режим листания',
  More: 'Ещё',
  'Pin video': 'Закрепить видео',
  'Shrink video': 'Уменьшить видео',
  'New words on the page you leave become known. You can undo this.':
    'Новые слова покинутой страницы становятся известными. Действие можно отменить.',
  'New words in the fragment you leave become known. You can undo this.':
    'Новые слова покинутого фрагмента становятся известными. Действие можно отменить.',
  'Saving page progress…': 'Сохраняем прогресс страницы…',
  'Saving fragment progress…': 'Сохраняем прогресс фрагмента…',
  'Could not save the page. Retry saving, then press Play.':
    'Не удалось сохранить страницу. Повторите сохранение, затем нажмите Play.',
  'Could not save the fragment. Retry saving, then press Play.':
    'Не удалось сохранить фрагмент. Повторите сохранение, затем нажмите Play.',
  'Play from {{time}}': 'Воспроизвести с {{time}}',
  'By fragment': 'По фрагментам',
  'Previous fragment': 'Предыдущий фрагмент',
  'Next fragment': 'Следующий фрагмент',
  'YouTube link': 'Ссылка YouTube',
  Import: 'Импортировать',
  'Retry import': 'Повторить импорт',
  'Import the title and captions from YouTube. Language: {{language}}.':
    'Название и субтитры будут импортированы с YouTube. Язык: {{language}}.',
  'Prefer creator captions, then automatic captions in the same language.':
    'Сначала авторские субтитры, затем автоматические на том же языке.',
  'Could not reach YouTube. Try importing again.':
    'Не удалось связаться с YouTube. Попробуйте повторить импорт.',
  'YouTube blocked requests from this server. Try again later.':
    'YouTube отклонил запросы этого сервера. Попробуйте позже.',
  'This video has no captions in your learning language.':
    'У видео нет субтитров на изучаемом языке.',
  'Captions are unavailable for this video.': 'У этого видео субтитры недоступны.',
  'Video unavailable. Check the link and access to the video.':
    'Видео недоступно. Проверьте ссылку и доступ к видео.',
  'Could not retrieve the title. Check access to the video.':
    'Не удалось получить название видео. Проверьте доступ к видео.',
  'Captions contain invalid text or timestamps.':
    'Субтитры содержат некорректный текст или таймкоды.',
  'Captions exceed the limit: 5 MiB, 20,000 cues or 6 hours.':
    'Субтитры превышают лимит: 5 МиБ, 20 000 реплик или 6 часов.',
  'Import timed out. Try again.': 'Импорт занял слишком много времени. Попробуйте повторить.',
  'Enter an HTTPS link to a single YouTube video.': 'Введите HTTPS-ссылку на одно видео YouTube.',
  'Could not import this video. Try again later.':
    'Не удалось импортировать видео. Попробуйте позже.',
  'Edit text within each fragment. Timing and order stay the same.':
    'Исправляйте текст внутри фрагментов. Их время и порядок сохраняются.',
  'Fragment {{number}} · {{range}}': 'Фрагмент {{number}} · {{range}}',
  'The material has changed or is still processing. Reload before saving.':
    'Материал изменился или ещё обрабатывается. Обновите страницу перед сохранением.',
}
