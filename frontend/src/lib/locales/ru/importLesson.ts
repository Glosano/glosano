import type { Catalog } from '@/lib/i18n'

export const importLessonMessages: Catalog = {
  File: 'Файл',
  'Import method': 'Способ импорта',
  'Drop a file here': 'Перетащите файл сюда',
  'Choose file': 'Выбрать файл',
  'Choose one file.': 'Выберите один файл.',
  'Choose a .txt or .md file.': 'Выберите файл .txt или .md.',
  'Only .txt and .md files with text content are supported.':
    'Поддерживаются только .txt и .md с текстовым содержимым.',
  'The file must not exceed 5 MiB.': 'Размер файла не должен превышать 5 МиБ.',
  'Save the file as UTF-8 and try again.': 'Сохраните файл в кодировке UTF-8 и попробуйте снова.',
  'The file must contain non-empty text.': 'Файл должен содержать непустой текст.',
  'Upload a UTF-8 .txt or .md file, up to 5 MiB. Lesson language: {{language}}.':
    'Загрузите .txt или .md в UTF-8, до 5 МиБ. Язык урока: {{language}}.',
  'Could not process the lesson. Close this window and try importing again.':
    'Не удалось обработать урок. Закройте окно и попробуйте импортировать снова.',
  'Processing lesson… You can close this window: the import will continue.':
    'Обработка урока… Можно закрыть окно: импорт продолжится.',
  'Check status': 'Проверить статус',
}
