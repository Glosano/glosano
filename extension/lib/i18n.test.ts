import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import messages from '../public/_locales/en/messages.json'
import { t } from './i18n'

const ROOT = join(__dirname, '..')
const SOURCE_DIRS = ['lib', 'entrypoints']
const MANIFEST_KEYS = ['extName', 'extDescription']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

const sources = SOURCE_DIRS.flatMap((d) => sourceFiles(join(ROOT, d))).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, 'utf8'),
}))
const catalog = Object.keys(messages)

describe('i18n catalog', () => {
  it('has every key referenced by t() in the sources', () => {
    const used = sources.flatMap(({ text }) => [...text.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]))
    expect(used.filter((key) => !catalog.includes(key!))).toEqual([])
  })

  it('has no keys that no source mentions', () => {
    const all = sources.map((s) => s.text).join('\n') + readFileSync(join(ROOT, 'wxt.config.ts'), 'utf8')
    const unused = catalog.filter((key) => !all.includes(`'${key}'`) && !all.includes(`__MSG_${key}__`))
    expect(unused).toEqual([])
  })

  it('manifest keys exist', () => {
    for (const key of MANIFEST_KEYS) expect(catalog).toContain(key)
  })

  it('t() substitutes placeholders', () => {
    expect(t('error_unreachable', 'http://x')).toBe("Can't reach Glosano at http://x.")
  })
})
