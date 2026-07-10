import { markdown as mdClass } from '@/shared/config/markdown'

type CalloutTag = 'CatTip' | 'MouseTrap'

interface CalloutVariant {
  className: string
  fallbackTitle: string
  kicker: string
}

const calloutVariants: Record<CalloutTag, CalloutVariant> = {
  CatTip: {
    className: mdClass.calloutTip,
    fallbackTitle: 'Практический ориентир',
    kicker: 'Совет',
  },
  MouseTrap: {
    className: mdClass.calloutTrap,
    fallbackTitle: 'Разбор частой ошибки',
    kicker: 'Осторожно',
  },
}

const componentImportPattern = /^import\s+(CatTip|MouseTrap)\s+from\s+["'][^"']+["'];?\s*$/gm
const calloutPattern = /<(CatTip|MouseTrap)([^>]*)>([\s\S]*?)<\/\1>/g

export function stripCourseComponentImports(content: string): string {
  return content.replace(componentImportPattern, '')
}

export function replaceCourseCallouts(
  content: string,
  renderInner: (content: string) => string,
): { content: string; callouts: string[] } {
  const callouts: string[] = []
  const contentWithPlaceholders = content.replace(calloutPattern, (_match, tag: CalloutTag, attrs: string, inner: string) => {
    const key = `COURSE_CALLOUT_${callouts.length}`
    const title = extractTitle(attrs)

    callouts.push(renderCourseCallout(tag, title, renderInner(inner.trim())))
    return `\n\n${key}\n\n`
  })

  return { content: contentWithPlaceholders, callouts }
}

export function restoreCourseCallouts(html: string, callouts: string[]): string {
  return callouts.reduce((result, callout, index) => {
    const key = `COURSE_CALLOUT_${index}`

    return result.replace(new RegExp(`<p>${key}</p>`, 'g'), callout).replace(new RegExp(key, 'g'), callout)
  }, html)
}

function renderCourseCallout(tag: CalloutTag, title: string, innerHtml: string): string {
  const variant = calloutVariants[tag]

  return [
    `<aside class="${mdClass.callout} ${variant.className}">`,
    `<div class="${mdClass.calloutKicker}">${variant.kicker}</div>`,
    `<p class="${mdClass.calloutTitle}">${escapeHtml(title || variant.fallbackTitle)}</p>`,
    `<div class="${mdClass.calloutBody}">${innerHtml}</div>`,
    `</aside>`,
  ].join('')
}

function extractTitle(attrs: string): string {
  const quoted = attrs.match(/title=(?:"([^"]+)"|'([^']+)')/)
  const braced = attrs.match(/title=\{(?:"([^"]+)"|'([^']+)')\}/)

  return quoted?.[1] ?? quoted?.[2] ?? braced?.[1] ?? braced?.[2] ?? ''
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
