import { type Catalog, ctx } from '@/lib/i18n'

export const reviewMessages: Catalog = {
  'Could not recall': 'Не вспомнил',
  'Recognized after reveal': 'Узнал после ответа',
  'Almost recalled': 'Почти вспомнил',
  'Recalled with difficulty': 'Вспомнил с трудом',
  Recalled: 'Вспомнил',
  'Recalled immediately': 'Вспомнил сразу',
  'Rate how easily you recalled the word.': 'Оцените, насколько легко вы вспомнили слово.',
  'Your choice has been checked. Now rate how easily you recalled the word.':
    'Выбор проверен. Теперь оцените, насколько легко вы вспомнили слово.',
  'Finish session': 'Завершить занятие',
  'Choose an activity': 'Выбрать занятие',
  [ctx('title', 'Choose an activity')]: 'Выберите занятие',
  'Back to material results': 'К итогам материала',
  'Example from the material': 'Пример из материала',
  'AI-generated example': 'AI-пример',
  'AI translation of the example': 'AI-перевод примера',
  'AI feedback': 'AI-проверка',
  'Translating the example…': 'Переводим пример…',
  'The example translation is unavailable. You can continue reviewing.':
    'Перевод примера недоступен. Можно продолжить повторение.',
  'No saved translation': 'Перевод не сохранён',
  'This item is no longer available. Skip this exercise.':
    'Слово больше не доступно. Пропустите задание.',
  'Mistakes from the previous session: {{count}} of {{total}} available.':
    'Ошибки предыдущего занятия: доступно {{count}} из {{total}}.',
  'Answers saved': 'Ответов сохранено',
  Skipped: 'Пропущено',
  Unanswered: 'Осталось без ответа',
  Mistakes: 'Ошибки',
  'Moved to known': 'Перешло в известные',
  'The last attempt is unconfirmed and is not included in these results.':
    'Последняя попытка не подтверждена и не включена в итоги.',
  'The remaining mistakes are available in the next session.':
    'Остальные ошибки доступны в следующем занятии.',
  'Practise difficult words': 'Закрепить трудные слова',
  'These mistakes are no longer available for review.':
    'Выбранные ошибки больше не доступны для повторения.',
  'Fill in the word': 'Вставить слово',
  'Extra practice — your review schedule stays the same.':
    'Дополнительная практика — без изменения расписания.',
  'No words are available for this practice.': 'Нет доступных слов для этой практики.',
  Attempts: 'Попыток',
  Matches: 'Совпадений',
  'With a hint': 'С подсказкой',
  'Difficult words: {{count}} of {{total}} available.':
    'Трудные слова: доступно {{count}} из {{total}}.',
  'Enter the whole phrase': 'Введите фразу целиком',
  'Enter the missing word': 'Введите пропущенное слово',
  Hint: 'Подсказка',
  'Correct!': 'Верно!',
  'This exercise practises a different word.': 'В этом задании изучаем другое слово.',
  'Your answer: {{answer}}': 'Ваш ответ: {{answer}}',
  'Studied form: {{answer}}': 'Изучаемая форма: {{answer}}',
  'Getting started': 'Знакомство',
  'Scheduled review': 'Повторение по расписанию',
  'Review this material’s vocabulary': 'Повторение лексики материала',
  'Extra practice': 'Дополнительная практика',
  'Recall the meaning and reveal the answer': 'Вспомните значение и раскройте ответ',
  'Type the missing word or phrase': 'Введите пропущенное слово или фразу',
  'Available: {{total}} · This session: {{count}}': 'Доступно: {{total}} · В занятии: {{count}}',
  'Saved today: {{done}} of {{limit}} reviews.':
    'Сегодня сохранено: {{done}} из {{limit}} повторений.',
  'Session size is limited by your remaining daily allowance.':
    'Размер занятия ограничен остатком дневного лимита.',
  'The remaining vocabulary is available in later sessions.':
    'Остальная лексика доступна в следующих занятиях.',
  'Open flashcards': 'Перейти к карточкам',
  'Attempts: {{count}} · Skipped: {{skipped}} · Remaining: {{remaining}}':
    'Попыток: {{count}} · Пропущено: {{skipped}} · Осталось: {{remaining}}',
  Mistake: 'Ошибка',
}
