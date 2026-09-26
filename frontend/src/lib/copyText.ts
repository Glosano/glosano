/**
 * Copies text to the clipboard. The async Clipboard API exists only in secure
 * contexts, so self-hosted instances opened over plain HTTP on a LAN address
 * fall back to a hidden textarea and `execCommand('copy')`.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* Permission denied or unavailable: try the legacy path. */
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}
