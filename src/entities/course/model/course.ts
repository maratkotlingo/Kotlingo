import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import properties from 'highlight.js/lib/languages/properties'
import plaintext from 'highlight.js/lib/languages/plaintext'
import xml from 'highlight.js/lib/languages/xml'
import { markdown as mdClass } from '@/shared/config/markdown'
import { replaceCourseCallouts, restoreCourseCallouts, stripCourseComponentImports } from './courseCallouts'

export interface LessonHeading {
  id: string
  title: string
  level: number
}

export interface CourseLesson {
  id: string
  slug: string
  order: number
  title: string
  description: string
  category: string
  difficulty: string
  body: string
  html: string
  headings: LessonHeading[]
  readingMinutes: number
  codeBlocks: number
}

export interface CourseModule {
  id: string
  title: string
  lessons: CourseLesson[]
}

export interface CourseContent {
  lessons: CourseLesson[]
  modules: CourseModule[]
  categories: string[]
  difficulties: string[]
  stats: CourseStats
}

export interface CourseStats {
  lessonCount: number
  moduleCount: number
  totalMinutes: number
}

interface RenderEnv {
  headings: LessonHeading[]
  headingCounts: Map<string, number>
}

interface LessonFrontmatter {
  title?: string
  description?: string
  order?: number
  category?: string
  difficulty?: string
}

const rawLessons = import.meta.glob<string>('../content/**/*.mdx', {
  eager: true,
  import: 'default',
  query: '?raw',
})

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('java', java)
hljs.registerLanguage('json', json)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('properties', properties)
hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('xml', xml)

const markdown = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: true,
  typographer: true,
})

const baseHeadingOpen = markdown.renderer.rules.heading_open

markdown.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
  const renderEnv = env as RenderEnv
  const token = tokens[index]
  const inlineToken = tokens[index + 1] as Token | undefined
  const title = plainHeadingTitle(inlineToken)
  const baseId = slugify(title)
  const currentCount = renderEnv.headingCounts.get(baseId) ?? 0
  const id = currentCount === 0 ? baseId : `${baseId}-${currentCount + 1}`

  renderEnv.headingCounts.set(baseId, currentCount + 1)
  token.attrSet('id', id)

  const level = Number(token.tag.replace('h', ''))

  if (level === 2) {
    renderEnv.headings.push({ id, title, level })
  }

  const headingClass = level === 2 ? mdClass.h2 : level === 3 ? mdClass.h3 : mdClass.h4
  token.attrJoin('class', headingClass)

  if (baseHeadingOpen) {
    return baseHeadingOpen(tokens, index, options, env, renderer)
  }

  return renderer.renderToken(tokens, index, options)
}

function plainHeadingTitle(token: Token | undefined): string {
  const children = token?.children

  if (!children || children.length === 0) {
    return token?.content.replace(/`+/g, '') ?? ''
  }

  return children.map((child) => child.content).join('').trim()
}

markdown.renderer.rules.paragraph_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrJoin('class', mdClass.p)
  return renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.bullet_list_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrJoin('class', mdClass.ul)
  return renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.ordered_list_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrJoin('class', mdClass.ol)
  return renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.list_item_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrJoin('class', mdClass.li)
  return renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrJoin('class', mdClass.link)
  return renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.code_inline = (tokens, index) =>
  `<code class="${mdClass.inlineCode}">${escapeHtml(tokens[index].content)}</code>`

markdown.renderer.rules.blockquote_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrJoin('class', mdClass.blockquote)
  return renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.table_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrJoin('class', mdClass.table)
  return renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.th_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrJoin('class', mdClass.th)
  return renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.td_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrJoin('class', mdClass.td)
  return renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index]
  const language = normalizeLanguage(token.info.trim().split(/\s+/)[0] || 'text')
  const safeLanguage = escapeHtml(language)
  const highlightedCode = highlightCode(token.content, language)

  return [
    `<figure class="${mdClass.codeFrame}">`,
    `<figcaption class="${mdClass.codeCaption}"><span>${safeLanguage}</span></figcaption>`,
    `<pre class="${mdClass.pre}"><code class="${mdClass.codeBlock} hljs language-${safeLanguage}">${highlightedCode}</code></pre>`,
    `</figure>`,
  ].join('')
}

export const kotlinCourse = createCourseContent('kotlin')
export const composeCourse = createCourseContent('compose')

export const courseLessons: CourseLesson[] = kotlinCourse.lessons
export const courseModules: CourseModule[] = kotlinCourse.modules
export const courseCategories = kotlinCourse.categories
export const courseDifficulties = kotlinCourse.difficulties
export const courseStats = kotlinCourse.stats

export const composeCourseLessons: CourseLesson[] = composeCourse.lessons
export const composeCourseModules: CourseModule[] = composeCourse.modules
export const composeCourseCategories = composeCourse.categories
export const composeCourseDifficulties = composeCourse.difficulties
export const composeCourseStats = composeCourse.stats

function createCourseContent(track: string): CourseContent {
  const lessons = Object.entries(rawLessons)
    .filter(([path]) => lessonPathTrack(path) === track)
    .map(([path, source]) => createLesson(path, source))
    .sort((first, second) => first.order - second.order)

  const modules = Array.from(
    lessons.reduce((groupedModules, lesson) => {
      const moduleLessons = groupedModules.get(lesson.category) ?? []
      moduleLessons.push(lesson)
      groupedModules.set(lesson.category, moduleLessons)
      return groupedModules
    }, new Map<string, CourseLesson[]>()),
  ).map(([title, moduleLessons]) => ({
    id: slugify(title),
    title,
    lessons: moduleLessons,
  }))

  const categories = modules.map((module) => module.title)
  const difficulties = Array.from(new Set(lessons.map((lesson) => lesson.difficulty))).sort(
    (first, second) => difficultyWeight(first) - difficultyWeight(second) || first.localeCompare(second, 'ru'),
  )
  const stats = {
    lessonCount: lessons.length,
    moduleCount: modules.length,
    totalMinutes: lessons.reduce((total, lesson) => total + lesson.readingMinutes, 0),
  }

  return {
    lessons,
    modules,
    categories,
    difficulties,
    stats,
  }
}

function createLesson(path: string, source: string): CourseLesson {
  const parsed = parseFrontmatter(source)
  const data = parsed.data
  const body = normalizeMdxBody(parsed.content)
  const { html, headings } = renderMarkdown(body)
  const slug = fileSlug(path)
  const textForReading = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
  const wordCount = textForReading.trim().split(/\s+/).filter(Boolean).length

  return {
    id: slug,
    slug,
    order: Number(data.order ?? 0),
    title: String(data.title ?? slug),
    description: String(data.description ?? ''),
    category: String(data.category ?? 'Курс'),
    difficulty: String(data.difficulty ?? 'Начальный'),
    body,
    html,
    headings,
    readingMinutes: Math.max(4, Math.ceil(wordCount / 170)),
    codeBlocks: (body.match(/```/g)?.length ?? 0) / 2,
  }
}

function parseFrontmatter(source: string): { data: LessonFrontmatter; content: string } {
  const normalizedSource = source.replace(/^\uFEFF/, '')
  const match = normalizedSource.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)

  if (!match) {
    return { data: {}, content: normalizedSource }
  }

  const data: LessonFrontmatter = {}
  const frontmatter = match[1]

  frontmatter.split(/\r?\n/).forEach((line) => {
    const separatorIndex = line.indexOf(':')

    if (separatorIndex === -1) {
      return
    }

    const key = line.slice(0, separatorIndex).trim() as keyof LessonFrontmatter
    const rawValue = line.slice(separatorIndex + 1).trim()
    const parsedValue = parseFrontmatterValue(rawValue)

    if (key === 'order' && typeof parsedValue === 'number') {
      data.order = parsedValue
      return
    }

    if (key !== 'order' && typeof parsedValue === 'string') {
      data[key] = parsedValue
    }
  })

  return { data, content: normalizedSource.slice(match[0].length) }
}

function parseFrontmatterValue(rawValue: string): string | number {
  if (/^\d+$/.test(rawValue)) {
    return Number(rawValue)
  }

  const quoted = rawValue.match(/^["']([\s\S]*)["']$/)
  return quoted?.[1] ?? rawValue
}

function normalizeMdxBody(content: string): string {
  return stripCourseComponentImports(content).trim()
}

function renderMarkdown(content: string): { html: string; headings: LessonHeading[] } {
  const { content: contentWithPlaceholders, callouts } = replaceCourseCallouts(
    content,
    (inner) =>
      markdown.render(inner, {
        headings: [],
        headingCounts: new Map<string, number>(),
      } satisfies RenderEnv),
  )

  const env: RenderEnv = { headings: [], headingCounts: new Map<string, number>() }
  const html = restoreCourseCallouts(markdown.render(contentWithPlaceholders, env), callouts)

  return { html, headings: env.headings }
}

function fileSlug(path: string): string {
  return path
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.mdx$/, '')
    .replace(/^\d+-/, '') ?? path
}

function lessonPathTrack(path: string): string {
  return path.replace(/\\/g, '/').match(/\/content\/([^/]+)\//)?.[1] ?? ''
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'section'
}

function difficultyWeight(value: string): number {
  const weights = new Map([
    ['Начальный', 1],
    ['Средний', 2],
    ['Продвинутый', 3],
    ['Эксперт', 4],
  ])

  return weights.get(value) ?? 10
}

function normalizeLanguage(language: string): string {
  const normalized = language.toLowerCase()
  const aliases = new Map([
    ['kt', 'kotlin'],
    ['kts', 'kotlin'],
    ['sh', 'bash'],
    ['shell', 'bash'],
    ['text', 'plaintext'],
    ['toml', 'ini'],
    ['txt', 'plaintext'],
  ])

  return aliases.get(normalized) ?? normalized
}

function highlightCode(code: string, language: string): string {
  if (!hljs.getLanguage(language)) {
    return escapeHtml(code)
  }

  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(code)
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

