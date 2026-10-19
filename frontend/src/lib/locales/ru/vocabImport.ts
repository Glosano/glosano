import type { Catalog } from '@/lib/i18n'

export const vocabImportMessages: Catalog = {
  'More actions': 'Ещё действия',
  'Import from LingQ…': 'Импорт из LingQ…',
  'Import from LingQ': 'Импорт из LingQ',
  'Words and phrases go to your {{language}} vocabulary.':
    'Слова и фразы попадут в ваш словарь ({{language}}).',
  'New import': 'Новый импорт',
  'By token (with levels)': 'По токену (с уровнями)',
  'CSV file': 'Файл CSV',
  'Import LingQ tags': 'Переносить теги LingQ',
  'Paste your LingQ API key.': 'Вставьте API-ключ LingQ.',
  'Sign in to LingQ and open the API key page': 'Войдите в LingQ и откройте страницу API-ключа',
  'Copy the key and paste it here': 'Скопируйте ключ и вставьте сюда',
  'LingQ API key': 'API-ключ LingQ',
  'The key is used only for this import and is not saved.':
    'Ключ используется только для этого импорта и нигде не сохраняется.',
  'Words you marked as known while reading in LingQ are not transferred yet — only your LingQ cards.':
    'Слова, отмеченные как известные при чтении в LingQ, пока не переносятся — только ваши карточки LingQ.',
  'If a word is already in your vocabulary': 'Если слово уже есть в словаре',
  'Keep its level': 'Оставить уровень как есть',
  'Update from LingQ': 'Обновить из LingQ',
  'Start import': 'Начать импорт',
  'Choose a CSV file.': 'Выберите файл CSV.',
  'A CSV export has no levels, review dates or known words. To transfer levels and review dates, use the token tab.':
    'В выгрузке CSV нет уровней, дат повторения и известных слов. Чтобы перенести уровни и даты повторения, используйте вкладку «По токену».',
  'Level for new words': 'Уровень для новых слов',
  'Studying, confidence {{value}}': 'В изучении, уверенность {{value}}',
  'Importing…': 'Импорт…',
  'Importing… {{done}} of {{total}}': 'Импорт… {{done}} из {{total}}',
  'You can close this window — the import will continue.':
    'Окно можно закрыть — импорт продолжится.',
  'Row {{row}}': 'Строка {{row}}',
  'Import finished': 'Импорт завершён',
  'Added: {{words}} words, {{phrases}} phrases': 'Добавлено: слов — {{words}}, фраз — {{phrases}}',
  'Updated: {{value}}': 'Обновлено: {{value}}',
  'New known words: {{value}}': 'Новых известных слов: {{value}}',
  'Skipped: {{value}}': 'Пропущено: {{value}}',
  'Show details': 'Показать подробности',
  'and {{value}} more not shown': 'Не показано ещё: {{value}}',
  'The import was interrupted. Start it again — nothing will be duplicated.':
    'Импорт прерван. Запустите его заново — ничего не задвоится.',
  'The import failed. Try again later.': 'Импорт не удался. Попробуйте позже.',
  'Lost connection to the server — the import status is unknown.':
    'Связь с сервером потеряна — состояние импорта неизвестно.',
  'Check again': 'Проверить снова',
  'An import is already running.': 'Импорт уже идёт.',
  'Set your native language in the profile first.': 'Сначала укажите родной язык в профиле.',
  'The file is not a UTF-8 CSV.': 'Файл не является CSV в кодировке UTF-8.',
  'This does not look like a LingQ export: there is no "term" column.':
    'Это не похоже на выгрузку LingQ: нет столбца «term».',
  'The file looks damaged or is not a CSV export.': 'Файл повреждён или не является выгрузкой CSV.',
  'The file has too many rows.': 'В файле слишком много строк.',
  'The file is too large.': 'Файл слишком большой.',
  'Choose a level for new words.': 'Выберите уровень для новых слов.',
  'The import was not found.': 'Импорт не найден.',
  'LingQ rejected the key. Check it and try again.':
    'LingQ отклонил ключ. Проверьте его и попробуйте снова.',
  'LingQ is unreachable from the server. Try again later.':
    'Сервер не может связаться с LingQ. Попробуйте позже.',
  'LingQ did not accept the request. Check the selected language.':
    'LingQ не принял запрос. Проверьте выбранный язык.',
  'You have too many LingQ cards in this language to import by token.':
    'В этом языке у вас слишком много карточек LingQ для импорта по токену.',
  'Empty term': 'Пустой термин',
  'Phrase is longer than 8 words': 'Фраза длиннее 8 слов',
  'Term is longer than 256 characters': 'Термин длиннее 256 символов',
  'Translation skipped: language not supported': 'Перевод пропущен: язык не поддерживается',
  'Translation is longer than 512 characters': 'Перевод длиннее 512 символов',
  'Tag is longer than 64 characters': 'Тег длиннее 64 символов',
  'Note is longer than 4000 characters': 'Заметка длиннее 4000 символов',
  'This row was skipped.': 'Строка пропущена.',
}
