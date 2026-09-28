const READER_PATH = /^\/learn\/[^/]+\/lessons\/[^/]+\/?$/

/** True for the lesson reader itself, not its edit page or other /learn pages. */
export function isReaderPath(pathname: string): boolean {
  return READER_PATH.test(pathname)
}
