import { hostPattern } from './permissions'

describe('hostPattern', () => {
  it('drops the port, which Firefox match patterns ignore', () => {
    expect(hostPattern('http://localhost:8000')).toBe('http://localhost/*')
    expect(hostPattern('https://glosano.example.com:8443')).toBe('https://glosano.example.com/*')
  })

  it('keeps scheme and host of a default-port origin', () => {
    expect(hostPattern('https://glosano.example.com')).toBe('https://glosano.example.com/*')
    expect(hostPattern('http://127.0.0.1')).toBe('http://127.0.0.1/*')
  })

  it('keeps the brackets of an IPv6 host', () => {
    expect(hostPattern('http://[::1]:8000')).toBe('http://[::1]/*')
  })
})
