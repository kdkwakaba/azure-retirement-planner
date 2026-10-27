import type { ReactNode } from 'react'

const excludedTags = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'svg',
  'iframe',
  'object',
  'embed',
  'form',
])
const evidenceHosts = ['aka.ms', 'azure.com', 'microsoft.com']

function safeEvidenceUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !evidenceHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
      return null
    return url.href
  } catch {
    return null
  }
}

function renderNode(
  node: Node,
  key: string,
  preserveWhitespace = false,
): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    return preserveWhitespace ? text : text.replace(/\s+/g, ' ')
  }
  if (!(node instanceof Element)) return null

  const tag = node.tagName.toLowerCase()
  if (excludedTags.has(tag)) return null
  const keepWhitespace = preserveWhitespace || tag === 'pre'
  const children = Array.from(node.childNodes).map((child, index) =>
    renderNode(child, `${key}-${index}`, keepWhitespace),
  )
  switch (tag) {
    case 'br':
      return <br key={key} />
    case 'hr':
      return <hr key={key} />
    case 'p':
      return <p key={key}>{children}</p>
    case 'ul':
      return <ul key={key}>{children}</ul>
    case 'ol':
      return <ol key={key}>{children}</ol>
    case 'li':
      return <li key={key}>{children}</li>
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return <h4 key={key}>{children}</h4>
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>
    case 'pre':
      return <pre key={key}>{children}</pre>
    case 'code':
      return <code key={key}>{children}</code>
    case 'strong':
    case 'b':
      return <strong key={key}>{children}</strong>
    case 'em':
    case 'i':
      return <em key={key}>{children}</em>
    case 'a': {
      const href = safeEvidenceUrl(node.getAttribute('href'))
      return href ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ) : (
        <span key={key}>{children}</span>
      )
    }
    case 'div':
    case 'main':
    case 'article':
    case 'section':
      return <div key={key}>{children}</div>
    default:
      return <span key={key}>{children}</span>
  }
}

export function EvidenceFact({ value }: { value: string }) {
  const trimmed = value.trim()
  if (!trimmed) return <p>根拠本文はありません。</p>

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return <pre>{JSON.stringify(JSON.parse(trimmed), null, 2)}</pre>
    } catch {
      // Invalid JSON remains plain text and is never interpreted as markup.
    }
  }

  if (!/<\/?[a-z][^>]*>/i.test(trimmed)) return <p>{trimmed}</p>

  const document = new DOMParser().parseFromString(trimmed, 'text/html')
  return (
    <div className="evidence-rich-text">
      {Array.from(document.body.childNodes).map((node, index) =>
        renderNode(node, `evidence-${index}`),
      )}
    </div>
  )
}

export function safeOfficialEvidenceUrl(value: string | null): string | null {
  return safeEvidenceUrl(value)
}
