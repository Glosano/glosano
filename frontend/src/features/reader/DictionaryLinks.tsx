import { ChevronRight, ExternalLink } from 'lucide-react'

import { useTranslation } from '@/lib/i18n'
import { buildDictionaryUrl } from './externalDictionaryUrl'
import { useExternalDictionaries } from './useExternalDictionaries'

interface Props {
  lang: string
  target: string
  text: string
  onConfigure: () => void
}

/** «Словари» row of the word card: links to external dictionaries (FLQ-46). */
export function DictionaryLinks({ lang, target, text, onConfigure }: Props) {
  const tr = useTranslation()
  const { data } = useExternalDictionaries(lang, target)
  const links = (data?.visible ?? []).flatMap((d) => {
    const href = buildDictionaryUrl(d, text)
    return href ? [{ d, href }] : []
  })

  return (
    <div data-testid="word-card-dictionaries" className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{tr('Dictionaries')}</p>
        <button
          type="button"
          onClick={onConfigure}
          className="flex items-center gap-0.5 rounded-md px-1 text-sm text-muted-foreground hover:bg-accent"
        >
          {tr('Customize')}
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      {links.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2">
          {links.map(({ d, href }) => (
            <li key={d.ref}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {d.name}
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
