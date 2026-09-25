import { useId } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import './chatMarkdown.css'

export function ChatMarkdown({ text }: { text: string }) {
  const footnotePrefix = `chat-${useId()}-`
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
        skipHtml
        components={{
          img: ({ alt }) => <span>{alt}</span>,
          a: ({ node, ...props }) => (
            <a
              {...props}
              aria-describedby={
                node?.properties.dataFootnoteRef
                  ? `${footnotePrefix}footnote-label`
                  : props['aria-describedby']
              }
              target={props.href?.startsWith('#') ? undefined : '_blank'}
              rel="noopener noreferrer"
            />
          ),
          h2: ({ id, className, children }) => (
            <h2
              id={id === 'footnote-label' ? `${footnotePrefix}footnote-label` : id}
              className={className}
            >
              {children}
            </h2>
          ),
          table: ({ children }) => (
            <div className="chat-markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
