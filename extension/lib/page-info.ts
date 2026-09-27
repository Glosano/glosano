import { Readability } from '@mozilla/readability'
import { nodesToLessonText } from './extract/html-to-text'
import { getSelectionFragment } from './extract/selection'
import { MAX_ELEMENTS } from './picker/article-detector'

export const PAGE_INFO_GLOBAL = '__glosanoPageInfo'

export interface PageInfo {
  url: string
  title: string
  byline: string | null
  siteName: string | null
  lang: string | null
  selection: string
}

function meta(doc: Document, selector: string): string | null {
  const value = doc.querySelector<HTMLMetaElement>(selector)?.content?.trim()
  return value || null
}

function readability(doc: Document): { title?: string | null; byline?: string | null; siteName?: string | null } {
  if (!doc.body || doc.body.getElementsByTagName('*').length > MAX_ELEMENTS) return {}
  try {
    return new Readability(doc.cloneNode(true) as Document).parse() ?? {}
  } catch {
    return {}
  }
}

export function collectPageInfo(doc: Document): PageInfo {
  const article = readability(doc)
  const fragment = getSelectionFragment(doc)
  return {
    url: doc.URL,
    title: article.title?.trim() || meta(doc, 'meta[property="og:title"]') || doc.title.trim(),
    byline: article.byline?.trim() || meta(doc, 'meta[name="author"]'),
    siteName: article.siteName?.trim() || meta(doc, 'meta[property="og:site_name"]'),
    lang: doc.documentElement.lang.trim() || meta(doc, 'meta[http-equiv="content-language" i]'),
    selection: fragment ? nodesToLessonText([fragment]) : '',
  }
}
