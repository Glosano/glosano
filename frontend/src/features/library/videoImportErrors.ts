export const VIDEO_IMPORT_ERRORS: Record<string, string> = {
  invalid_url: 'Введите HTTPS-ссылку на одно видео YouTube.',
  captions_language_unavailable: 'У видео нет субтитров на изучаемом языке.',
  import_expired: 'Импорт занял слишком много времени. Попробуйте повторить.',
  import_failed: 'Не удалось импортировать видео. Попробуйте позже.',
  queue_unavailable: 'Не удалось импортировать видео. Попробуйте позже.',
  network_error: 'Не удалось связаться с YouTube. Попробуйте повторить импорт.',
  request_blocked: 'YouTube отклонил запросы этого сервера. Попробуйте позже.',
  no_matching_transcript: 'У видео нет субтитров на изучаемом языке.',
  transcripts_disabled: 'У этого видео субтитры недоступны.',
  video_unavailable: 'Видео недоступно. Проверьте ссылку и доступ к видео.',
  metadata_unavailable: 'Не удалось получить название видео. Проверьте доступ к видео.',
  invalid_transcript: 'Субтитры содержат некорректный текст или таймкоды.',
  limit_exceeded: 'Субтитры превышают лимит: 5 МиБ, 20 000 реплик или 6 часов.',
  import_timeout: 'Импорт занял слишком много времени. Попробуйте повторить.',
  invalid_youtube_url: 'Введите HTTPS-ссылку на одно видео YouTube.',
}

export function videoImportError(code?: string): string {
  return (code && VIDEO_IMPORT_ERRORS[code]) || 'Не удалось импортировать видео. Попробуйте позже.'
}
