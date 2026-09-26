import type { AnchorHTMLAttributes, ReactNode } from 'react'

type MockLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  children?: ReactNode
  to: string
  params?: Record<string, string>
}

/**
 * Stand-in for TanStack Router's `Link` in component tests that render without a
 * router: it builds the same `href` the real Link would (`$param` → value), so
 * tests can still assert the target URL.
 */
export function MockLink({ to, params = {}, children, ...rest }: MockLinkProps) {
  const href = to.replace(/\$(\w+)/g, (_, name: string) => params[name] ?? `$${name}`)
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}
