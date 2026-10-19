import '@testing-library/jest-dom/vitest'
import { beforeAll, beforeEach } from 'vitest'

import { loadCatalog, setUiLanguage } from '@/lib/i18n'
import { UI_LANGUAGE_CODES } from '@/lib/uiLanguages'

// Tests render synchronously, so every catalog is loaded before the first one runs.
beforeAll(async () => {
  await Promise.all(UI_LANGUAGE_CODES.map(loadCatalog))
})

beforeEach(async () => {
  await setUiLanguage('ru')
})
