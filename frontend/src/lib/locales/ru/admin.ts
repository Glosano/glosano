import type { Catalog } from '../../i18n'

export const admin: Catalog = {
  'AI settings': 'Настройки AI',
  'API key': 'API-ключ',
  Administrator: 'Администратор',
  Application: 'Приложение',
  Environment: 'Окружение',
  'Configuration source': 'Источник настроек',
  'Connection preset': 'Шаблон подключения',
  'Connection successful.': 'Подключение работает.',
  'Enable AI': 'Включить AI',
  'Enter a new key': 'Ввести новый ключ',
  'Keep saved key': 'Сохранить текущий ключ',
  'No saved key': 'Ключ не сохранён',
  'Use no key / remove saved key': 'Без ключа / удалить сохранённый',
  'New API key': 'Новый API-ключ',
  'Load models': 'Загрузить список моделей',
  'Model identifier': 'Название модели',
  'Other compatible server': 'Другой совместимый сервер',
  'Reload settings': 'Загрузить настройки заново',
  'Save AI settings': 'Сохранить настройки AI',
  'Saved configuration': 'Сохранённая конфигурация',
  'Server address': 'Адрес сервера',
  'Test connection': 'Проверить подключение',
  'Working…': 'Выполняется…',
  'AI is blocked by the server environment.': 'AI заблокирован настройками окружения сервера.',
  'Settings changed elsewhere. Reload before saving.':
    'Настройки изменены в другом окне. Загрузите их заново перед сохранением.',
  'Enter a key for this server or choose no key.':
    'Введите ключ для этого сервера или выберите работу без ключа.',
  'The saved key cannot be read. Enter it again or remove it.':
    'Не удалось расшифровать ключ. Введите его заново или удалите.',
  'The instance secret is unsuitable for encryption. Contact the server owner.':
    'Секрет инстанса не подходит для шифрования. Обратитесь к владельцу сервера.',
  'Enter a valid server address. Metadata services are not allowed.':
    'Введите корректный адрес сервера. Сервисы метаданных запрещены.',
  'Use HTTPS for a public server.': 'Для публичного сервера используйте HTTPS.',
  'Enter the server address and model.': 'Укажите адрес сервера и модель.',
  'Enter a valid API key or choose no key.':
    'Введите корректный API-ключ или выберите работу без ключа.',
  'The server rejected the API key.': 'Сервер отклонил API-ключ.',
  'The model or endpoint was not found.': 'Модель или endpoint не найдены.',
  'This server does not list models. Enter the model manually.':
    'Сервер не возвращает список моделей. Введите название вручную.',
  'The server is unavailable. Check the address and connection.':
    'Сервер недоступен. Проверьте адрес и соединение.',
  'The server did not respond in time.': 'Сервер не ответил вовремя.',
  'The provider is limiting requests. Try again later.':
    'Провайдер ограничил запросы. Повторите позже.',
  'The server returned an incompatible response.': 'Сервер вернул несовместимый ответ.',
  'The server response was too large.': 'Ответ сервера слишком большой.',
  'One connection for translations, chat and practice. AI is optional.':
    'Одно подключение для переводов, чата и тренажёра. AI необязателен.',
  'You can always enter the model identifier manually.':
    'Название модели всегда можно ввести вручную.',
  'For a model on the Docker host, use host.docker.internal instead of localhost. The model server must already be running.':
    'Для модели на машине с Docker используйте host.docker.internal вместо localhost. Сервер модели должен быть запущен.',
  'Testing sends a short diagnostic request and may incur a provider charge. It does not change your active connection.':
    'Проверка отправляет короткий тестовый запрос, за который провайдер может списать оплату. Активное подключение не меняется.',
}
