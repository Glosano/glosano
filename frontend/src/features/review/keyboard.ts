/** Only handle one physical key press, outside editable controls and IME. */
export function ignoreReviewKey(event: KeyboardEvent): boolean {
  return (
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    (event.target instanceof HTMLElement &&
      !!event.target.closest('input, textarea, select, [contenteditable="true"], button, a'))
  )
}
