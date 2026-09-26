import { createRoute, useParams } from '@tanstack/react-router'

import { LibraryView } from '@/features/library/LibraryView'

import { learnLangRoute } from './learn.$lang'

export const learnLibraryRoute = createRoute({
  getParentRoute: () => learnLangRoute,
  path: 'library',
  component: function LibraryRoute() {
    const { lang } = useParams({ from: '/learn/$lang/library' })
    return <LibraryView lang={lang} />
  },
})
