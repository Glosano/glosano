export const CSRF_COOKIE = 'glosano_csrf'

export interface CookieReader {
  get(details: { url: string; name: string }): Promise<{ value: string } | null | undefined>
}

/**
 * Reads the instance's CSRF cookie. A failed lookup (Firefox first-party
 * isolation rejects calls without firstPartyDomain) counts as no cookie, which
 * the client reports as signed_out instead of an unexplained error.
 */
export async function readCsrfToken(cookies: CookieReader, origin: string): Promise<string | null> {
  try {
    return (await cookies.get({ url: origin, name: CSRF_COOKIE }))?.value ?? null
  } catch {
    return null
  }
}
