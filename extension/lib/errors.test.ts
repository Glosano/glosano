import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('renders every code with its detail', () => {
    expect(errorMessage({ code: 'unreachable', detail: 'https://g' })).toBe("Can't reach Glosano at https://g.")
    expect(errorMessage({ code: 'validation', detail: 'bad' })).toBe('Glosano rejected the lesson: bad')
    expect(errorMessage({ code: 'unknown', detail: '500' })).toBe('Something went wrong (500).')
    expect(errorMessage({ code: 'empty_text' })).toBe('Nothing to import.')
  })
})
