import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { type Catalog, ctx, intlLocale, type Message } from '@/lib/i18n'
import { UI_LANGUAGE_CODES, type UiLanguage } from '@/lib/uiLanguages'

const LOCALES_DIR = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = path.resolve(LOCALES_DIR, '../..')
const SEPARATOR = '\u0004'
const TRANSLATION_FUNCTIONS = new Set(['t', 'tr', 'translate', 'msg'])

// ---- catalogs -------------------------------------------------------------------------------

type CatalogModule = Record<string, unknown>
const modules = import.meta.glob<CatalogModule>('./*/*.ts', { eager: true })

/** Every catalog, merged per language directory; `directories` lists the directory names found. */
function loadCatalogs(): Map<string, Map<string, Message>> {
  const byLanguage = new Map<string, Map<string, Message>>()
  for (const [file, module] of Object.entries(modules)) {
    const language = file.split('/')[1]!
    const merged = byLanguage.get(language) ?? new Map<string, Message>()
    for (const exported of Object.values(module)) {
      for (const [key, message] of Object.entries(exported as Catalog)) {
        if (merged.has(key)) throw new Error(`Duplicate key in ${language}: ${JSON.stringify(key)}`)
        merged.set(key, message)
      }
    }
    byLanguage.set(language, merged)
  }
  return byLanguage
}

const catalogsByLanguage = loadCatalogs()
const russian = catalogsByLanguage.get('ru')!

function plainKey(key: string): string {
  const at = key.indexOf(SEPARATOR)
  return at === -1 ? key : key.slice(at + 1)
}

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!))].sort()
}

function forms(message: Message): [string, string][] {
  return typeof message === 'string' ? [['text', message]] : Object.entries(message)
}

// ---- source scanning ------------------------------------------------------------------------

function sourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry)
    if (statSync(full).isDirectory()) {
      if (full === LOCALES_DIR) continue
      files.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

const relative = (file: string) => path.relative(SRC_DIR, file)

function parse(file: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind)
}

/** String literals a `t()` first argument can evaluate to, looking through `a ? 'x' : 'y'`. */
function literalKeys(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
  if (ts.isParenthesizedExpression(node)) return literalKeys(node.expression)
  if (ts.isConditionalExpression(node)) {
    return [...literalKeys(node.whenTrue), ...literalKeys(node.whenFalse)]
  }
  return []
}

function usedKeys(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>()
  for (const file of sourceFiles(SRC_DIR)) {
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        TRANSLATION_FUNCTIONS.has(node.expression.text) &&
        node.arguments[0]
      ) {
        for (const key of literalKeys(node.arguments[0])) {
          const files = used.get(key) ?? new Set<string>()
          files.add(relative(file))
          used.set(key, files)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(parse(file))
  }
  return used
}

// ---- tests ----------------------------------------------------------------------------------

describe('translation catalogs', () => {
  it('every key used in code is in the Russian catalog', () => {
    const translatedKeys = new Set([...russian.keys()].map(plainKey))
    const missing = [...usedKeys()]
      .filter(([key]) => !translatedKeys.has(key))
      .map(([key, files]) => `${JSON.stringify(key)} (${[...files].join(', ')})`)
    expect(missing, `Missing in ru:\n${missing.join('\n')}`).toEqual([])
    expect(usedKeys().size).toBeGreaterThan(100)
  })

  it('every catalog directory has exactly the Russian key set', () => {
    const russianKeys = [...russian.keys()].sort()
    for (const code of UI_LANGUAGE_CODES) {
      if (code === 'en') continue
      expect(catalogsByLanguage.has(code), `no locales/${code}/ directory`).toBe(true)
    }
    for (const [language, catalog] of catalogsByLanguage) {
      if (language === 'en') continue
      const keys = [...catalog.keys()].sort()
      const missing = russianKeys.filter((key) => !catalog.has(key))
      const extra = keys.filter((key) => !russian.has(key))
      expect({ language, missing, extra }).toEqual({ language, missing: [], extra: [] })
    }
  })

  it('has no catalog directory outside the UI languages', () => {
    const known = new Set<string>(UI_LANGUAGE_CODES)
    expect([...catalogsByLanguage.keys()].filter((language) => !known.has(language))).toEqual([])
  })

  it('placeholders match the English key', () => {
    const problems: string[] = []
    for (const [language, catalog] of catalogsByLanguage) {
      for (const [key, message] of catalog) {
        const expected = placeholders(plainKey(key))
        for (const [form, text] of forms(message)) {
          // A plural form may leave the number out ("one" form: «одно слово»).
          const ignore = typeof message === 'string' ? [] : ['count']
          const actual = placeholders(text).filter((name) => !ignore.includes(name))
          const wanted = expected.filter((name) => !ignore.includes(name))
          if (actual.join() !== wanted.join()) {
            problems.push(
              `${language} ${JSON.stringify(key)} [${form}]: {{${actual}}} != {{${wanted}}}`,
            )
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it("plural entries cover the language's categories", () => {
    const problems: string[] = []
    for (const [language, catalog] of catalogsByLanguage) {
      const categories = new Intl.PluralRules(intlLocale(language as UiLanguage)).resolvedOptions()
        .pluralCategories
      for (const [key, message] of catalog) {
        if (typeof message === 'string') continue
        const present = new Set(Object.keys(message))
        const wanted = new Set([...categories, 'other'])
        const absent = [...wanted].filter((category) => !present.has(category))
        if (absent.length > 0) {
          problems.push(`${language} ${JSON.stringify(key)} lacks ${absent.join(', ')}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('keeps the context helper separator in sync with the catalogs', () => {
    expect(ctx('filter', 'Known')).toBe(`filter${SEPARATOR}Known`)
  })
})

// ---- no raw Cyrillic -------------------------------------------------------------------------

/** Files that may hold Cyrillic string literals, with the reason. */
const CYRILLIC_ALLOW_LIST: Record<string, string> = {}

function cyrillicLiterals(file: string): string[] {
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      if (/\p{Script=Cyrillic}/u.test(node.text.trim())) found.push(node.text.trim())
    }
    ts.forEachChild(node, visit)
  }
  visit(parse(file))
  return found
}

describe('no Cyrillic string literals outside catalogs', () => {
  it('finds Cyrillic only in allow-listed files', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC_DIR)) {
      const name = relative(file).split(path.sep).join('/')
      if (name in CYRILLIC_ALLOW_LIST) continue
      for (const literal of cyrillicLiterals(file)) offenders.push(`${name}: ${literal}`)
    }
    expect(offenders).toEqual([])
  })

  it('does not allow-list a file that has no Cyrillic any more', () => {
    for (const name of Object.keys(CYRILLIC_ALLOW_LIST)) {
      const literals = cyrillicLiterals(path.join(SRC_DIR, name))
      expect(literals.length, `${name} no longer needs its allow-list entry`).toBeGreaterThan(0)
    }
  })
})
