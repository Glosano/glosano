import type { QueryClient } from '@tanstack/react-query'

export async function invalidateMaterial(client: QueryClient, id: string, lang: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['lessons', lang] }),
    ...['lesson', 'lesson-edit', 'reader-content', 'reader-statuses', 'reader-vocabulary'].map(
      (key) => client.invalidateQueries({ queryKey: [key, id] }),
    ),
  ])
}
