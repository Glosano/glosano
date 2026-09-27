import { youtubeWatchUrl } from './youtube'

const ID = 'dQw4w9WgXcQ'
const WATCH = `https://www.youtube.com/watch?v=${ID}`

describe('youtubeWatchUrl', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&t=42s&list=PL1`,
    `https://youtube.com/watch?feature=share&v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://youtu.be/${ID}?t=10`,
  ])('%s', (url) => {
    expect(youtubeWatchUrl(url)).toBe(WATCH)
  })

  it.each([
    undefined,
    'https://www.youtube.com/',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/results?search_query=x',
    `https://notyoutube.com/watch?v=${ID}`,
    `https://example.com/?v=${ID}`,
    'about:blank',
  ])('rejects %s', (url) => {
    expect(youtubeWatchUrl(url)).toBeNull()
  })
})
