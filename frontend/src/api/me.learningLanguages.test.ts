import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({ api: vi.fn() }))

import { api } from './client'
import { meApi } from './me'

describe('meApi.addLearningLanguage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('posts the selected catalog code to the atomic profile endpoint', async () => {
    vi.mocked(api).mockResolvedValue({ learning_languages: ['pt', 'zh-Hans'] })

    await meApi.addLearningLanguage('zh-Hans')

    expect(api).toHaveBeenCalledWith('/me/learning-languages', {
      method: 'POST',
      body: JSON.stringify({ language_code: 'zh-Hans' }),
    })
  })
})
