import { languageLabel, pickDefaultLanguage } from './languages'

describe('pickDefaultLanguage', () => {
  it('uses the page language when the learner studies it', () => {
    expect(pickDefaultLanguage('pt-BR', ['en', 'pt'], 'en')).toBe('pt')
  })

  it.each(['zh', 'zh-CN', 'zh-Hans', 'zh-SG', 'zh-Hans-CN', 'ZH-cn'])('maps %s to zh-Hans', (lang) => {
    expect(pickDefaultLanguage(lang, ['zh-Hans', 'en'], 'en')).toBe('zh-Hans')
  })

  it('does not treat traditional Chinese as simplified', () => {
    expect(pickDefaultLanguage('zh-TW', ['zh-Hans', 'en'], 'en')).toBe('en')
  })

  it('falls back to the last used language, then the first one', () => {
    expect(pickDefaultLanguage('ko', ['en', 'pt'], 'pt')).toBe('pt')
    expect(pickDefaultLanguage(null, ['en', 'pt'], 'ja')).toBe('en')
    expect(pickDefaultLanguage(null, [], null)).toBeNull()
  })
})

describe('languageLabel', () => {
  it('uses the catalog name and falls back to the code', () => {
    expect(languageLabel('zh-Hans')).toBe('Chinese (Simplified)')
    expect(languageLabel('xx')).toBe('xx')
  })
})
