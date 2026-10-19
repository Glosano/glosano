import type { Catalog } from '@/lib/i18n'

/** English plural forms for reading and personal vocabulary. */
export const readerMessages: Catalog = {
  '{{count}} words marked as known': {
    one: '{{count}} word marked as known',
    other: '{{count}} words marked as known',
  },
  'Delete {{count}} words?': { one: 'Delete {{count}} word?', other: 'Delete {{count}} words?' },
}
