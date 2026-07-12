export const ROOT_ID = 'root'
export const DEFAULT_ACTIVE_FILE_ID = 'file-main'

export type SandboxNodeKind = 'file' | 'folder'

interface SandboxNodeBase {
  id: string
  parentId: string | null
  name: string
  kind: SandboxNodeKind
}

export interface SandboxFileNode extends SandboxNodeBase {
  kind: 'file'
  content: string
}

export interface SandboxFolderNode extends SandboxNodeBase {
  kind: 'folder'
}

export type SandboxNode = SandboxFileNode | SandboxFolderNode

export interface KotlinImport {
  path: string
  alias?: string
}

export interface KotlinDeclaration {
  kind: string
  name: string
}

export function createDefaultProject(): SandboxNode[] {
  return [
    { id: ROOT_ID, parentId: null, name: 'kotlingo-sandbox', kind: 'folder' },
    { id: 'folder-src', parentId: ROOT_ID, name: 'src', kind: 'folder' },
    { id: 'folder-playground', parentId: 'folder-src', name: 'playground', kind: 'folder' },
    {
      id: DEFAULT_ACTIVE_FILE_ID,
      parentId: 'folder-src',
      name: 'Main.kt',
      kind: 'file',
      content: `import playground.Greeter
import playground.User

fun main() {
    val greeter = Greeter(User("Kotlingo"))
    println(greeter.message())
}
`,
    },
    {
      id: 'file-greeter',
      parentId: 'folder-playground',
      name: 'Greeter.kt',
      kind: 'file',
      content: `package playground

class Greeter(private val user: User) {
    fun message(): String = "Hello, \${user.name}! Multi-file Kotlin is ready."
}
`,
    },
    {
      id: 'file-user',
      parentId: 'folder-playground',
      name: 'User.kt',
      kind: 'file',
      content: `package playground

data class User(val name: String)
`,
    },
  ]
}

export function isFileNode(node: SandboxNode | undefined): node is SandboxFileNode {
  return node?.kind === 'file'
}

export function isFolderNode(node: SandboxNode | undefined): node is SandboxFolderNode {
  return node?.kind === 'folder'
}

export function sortSandboxNodes(first: SandboxNode, second: SandboxNode): number {
  if (first.kind !== second.kind) {
    return first.kind === 'folder' ? -1 : 1
  }

  return first.name.localeCompare(second.name, 'ru', { sensitivity: 'base' })
}

export function createNodeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeFileName(name: string): string {
  const cleanName = sanitizeNodeName(name) || 'File.kt'

  if (cleanName.toLocaleLowerCase('en').endsWith('.kt')) {
    return cleanName
  }

  return `${cleanName.replace(/\.+$/, '')}.kt`
}

export function normalizeFolderName(name: string): string {
  return sanitizeNodeName(name) || 'folder'
}

export function makeUniqueNodeName(
  parentId: string,
  nodes: SandboxNode[],
  requestedName: string,
  currentNodeId?: string,
): string {
  const siblings = new Set(
    nodes
      .filter((node) => node.parentId === parentId && node.id !== currentNodeId)
      .map((node) => node.name.toLocaleLowerCase('ru')),
  )

  if (!siblings.has(requestedName.toLocaleLowerCase('ru'))) {
    return requestedName
  }

  const extensionMatch = requestedName.match(/(\.[^.]+)$/)
  const extension = extensionMatch?.[1] ?? ''
  const baseName = extension ? requestedName.slice(0, -extension.length) : requestedName

  let index = 2
  let candidate = `${baseName} ${index}${extension}`

  while (siblings.has(candidate.toLocaleLowerCase('ru'))) {
    index += 1
    candidate = `${baseName} ${index}${extension}`
  }

  return candidate
}

export function getNodePath(nodeId: string, nodes: SandboxNode[]): string {
  return getNodePathSegments(nodeId, nodes).join('/')
}

export function getNodePathSegments(nodeId: string, nodes: SandboxNode[]): string[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const segments: string[] = []
  let current = nodeMap.get(nodeId)

  while (current && current.id !== ROOT_ID) {
    segments.unshift(current.name)
    current = current.parentId ? nodeMap.get(current.parentId) : undefined
  }

  return segments
}

export function getDescendantIds(folderId: string, nodes: SandboxNode[]): string[] {
  const ids: string[] = []
  const visit = (parentId: string) => {
    nodes
      .filter((node) => node.parentId === parentId)
      .forEach((node) => {
        ids.push(node.id)

        if (isFolderNode(node)) {
          visit(node.id)
        }
      })
  }

  visit(folderId)
  return ids
}

export function packageNameFromFolder(folderId: string, nodes: SandboxNode[]): string {
  return getNodePathSegments(folderId, nodes)
    .filter((segment) => segment !== 'src')
    .map((segment) => segment.replace(/\.kt$/i, ''))
    .filter((segment) => /^[A-Za-z_][\w-]*$/.test(segment))
    .map((segment) => segment.replace(/-/g, '_'))
    .join('.')
}

export function sourceForNewKotlinFile(packageName: string): string {
  return packageName ? `package ${packageName}\n\n` : ''
}

export function parseKotlinPackage(content: string): string {
  return content.match(/^\s*package\s+([A-Za-z_][\w.]*)/m)?.[1] ?? ''
}

export function parseKotlinImports(content: string): KotlinImport[] {
  const imports: KotlinImport[] = []
  const importRegex = /^\s*import\s+([A-Za-z_][\w.]*\*?)(?:\s+as\s+([A-Za-z_]\w*))?/gm
  let match: RegExpExecArray | null

  while ((match = importRegex.exec(content)) !== null) {
    imports.push({ path: match[1], alias: match[2] })
  }

  return imports
}

export function parseKotlinDeclarations(content: string): KotlinDeclaration[] {
  return content
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .map((line) =>
      line.match(
        /^\s*(?:(?:public|internal|private|protected|expect|actual|sealed|data|open|abstract|final|inner|value|enum|annotation|companion|suspend|inline|tailrec|operator|infix|external|const|lateinit|override)\s+)*(class|interface|object|fun|val|var|typealias)\s+([A-Za-z_]\w*)/,
      ),
    )
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ kind: match[1], name: match[2] }))
}

export function formatKotlinCode(content: string): string {
  const trimmedContent = content.replace(/\r\n/g, '\n').trim()

  if (!trimmedContent) {
    return ''
  }

  const formattedLines: string[] = []
  let indentLevel = 0

  trimmedContent.split('\n').forEach((line) => {
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      if (formattedLines.at(-1) !== '') {
        formattedLines.push('')
      }

      return
    }

    const visibleLine = stripLineComment(stripQuotedStrings(trimmedLine))
    const closingPrefix = visibleLine.match(/^[})\]]+/)?.[0].length ?? 0
    const lineIndent = Math.max(0, indentLevel - closingPrefix)

    formattedLines.push(`${' '.repeat(lineIndent * 4)}${trimmedLine}`)

    indentLevel = Math.max(
      0,
      indentLevel + countIndentOpeners(visibleLine) - countIndentClosers(visibleLine),
    )
  })

  return `${formattedLines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}

function sanitizeNodeName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ')
}

function stripLineComment(line: string): string {
  const commentIndex = line.indexOf('//')

  if (commentIndex === -1) {
    return line
  }

  return line.slice(0, commentIndex)
}

function stripQuotedStrings(line: string): string {
  return line
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])'/g, "''")
}

function countIndentOpeners(line: string): number {
  return (line.match(/[({\[]/g) ?? []).length
}

function countIndentClosers(line: string): number {
  return (line.match(/[)}\]]/g) ?? []).length
}
