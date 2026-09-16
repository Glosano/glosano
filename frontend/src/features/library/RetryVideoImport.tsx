import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lessonsApi } from '@/api/lessons'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n'
import { videoImportError } from './videoImportErrors'

export function RetryVideoImport({ lessonId, lang }: { lessonId: string; lang: string }) {
  const t = useTranslation()
  const client = useQueryClient()
  const detail = useQuery({
    queryKey: ['lesson', lessonId],
    queryFn: () => lessonsApi.get(lessonId),
  })
  const retry = useMutation({
    mutationFn: () => lessonsApi.retryImport(lessonId),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['lesson', lessonId] }),
        client.invalidateQueries({ queryKey: ['lessons', lang] }),
      ]),
  })
  return (
    <div className="space-y-2 px-3 pb-3 text-xs">
      <p role="alert">{t(videoImportError(detail.data?.import_error?.code))}</p>
      {retry.isError && (
        <p role="alert">{t('Не удалось связаться с YouTube. Попробуйте повторить импорт.')}</p>
      )}
      {detail.data?.import_error?.retryable && (
        <Button
          size="sm"
          variant="outline"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          {t('Повторить импорт')}
        </Button>
      )}
    </div>
  )
}
