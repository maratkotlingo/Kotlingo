const API_ROOT = 'https://api.kotlinlang.org'
export const FALLBACK_KOTLIN_VERSION = '2.4.0'

export interface KotlinCompilerVersion {
  version: string
  latestStable?: boolean
  latestCompletion?: boolean
  redirectCompletion?: boolean
  hasComposeAssets?: boolean
}

export interface KotlinSourceFile {
  path: string
  content: string
}

export interface KotlinCompilerFile {
  name: string
  text: string
  publicId: string
}

export interface KotlinCompilerPosition {
  line: number
  ch: number
}

export interface KotlinCompilerDiagnostic {
  interval?: {
    start: KotlinCompilerPosition
    end: KotlinCompilerPosition
  }
  message: string
  severity: 'ERROR' | 'WARNING' | 'INFO' | string
  className?: string
}

export interface KotlinCompilerException {
  message?: string
  fullName?: string
  localizedMessage?: string | null
  stackTrace?: Array<{
    className?: string
    methodName?: string
    fileName?: string | null
    lineNumber?: number
  }>
}

export interface KotlinRunResponse {
  errors?: Record<string, KotlinCompilerDiagnostic[]>
  exception?: KotlinCompilerException | null
  jvmByteCode?: string | null
  text?: string
}

export interface RuntimeDiagnostic extends KotlinCompilerDiagnostic {
  fileName: string
  filePath: string
  line?: number
  column?: number
}

export interface PreparedCompilerProject {
  files: KotlinCompilerFile[]
  fileNameToPath: Map<string, string>
}

export async function fetchKotlinCompilerVersions(): Promise<KotlinCompilerVersion[]> {
  const response = await fetch(`${API_ROOT}/versions`)

  if (!response.ok) {
    throw new Error(`Kotlin versions request failed with ${response.status}`)
  }

  return response.json()
}

export function resolveLatestStableVersion(versions: KotlinCompilerVersion[]): string {
  return versions.find((version) => version.latestStable)?.version ?? versions[0]?.version ?? FALLBACK_KOTLIN_VERSION
}

export function prepareCompilerProject(sourceFiles: KotlinSourceFile[]): PreparedCompilerProject {
  const usedNames = new Set<string>()
  const fileNameToPath = new Map<string, string>()

  const files = sourceFiles.map((file, index) => {
    const safeName = makeSafeCompilerFileName(file.path, index, usedNames)
    fileNameToPath.set(safeName, file.path)

    return {
      name: safeName,
      text: file.content,
      publicId: '',
    }
  })

  return { files, fileNameToPath }
}

export async function runKotlinProject(
  files: KotlinCompilerFile[],
  compilerVersion: string,
  args: string,
): Promise<KotlinRunResponse> {
  const response = await fetch(`${API_ROOT}/api/${encodeURIComponent(compilerVersion)}/compiler/run`, {
    method: 'POST',
    body: JSON.stringify({
      args,
      files,
      confType: 'java',
    }),
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  })

  if (!response.ok) {
    throw new Error(`Kotlin run request failed with ${response.status}`)
  }

  return response.json()
}

export function flattenCompilerDiagnostics(
  response: KotlinRunResponse,
  fileNameToPath: Map<string, string>,
): RuntimeDiagnostic[] {
  return Object.entries(response.errors ?? {}).flatMap(([fileName, diagnostics]) =>
    diagnostics.map((diagnostic) => ({
      ...diagnostic,
      fileName,
      filePath: fileNameToPath.get(fileName) ?? fileName,
      line: diagnostic.interval ? diagnostic.interval.start.line + 1 : undefined,
      column: diagnostic.interval ? diagnostic.interval.start.ch + 1 : undefined,
    })),
  )
}

export function cleanCompilerText(text: string | undefined): string {
  if (!text) {
    return ''
  }

  return text
    .replace(/<outStream>/g, '')
    .replace(/<\/outStream>/g, '')
    .replace(/<errStream>/g, '[stderr]\n')
    .replace(/<\/errStream>/g, '')
    .trimEnd()
}

export function formatCompilerException(exception: KotlinCompilerException | null | undefined): string {
  if (!exception) {
    return ''
  }

  const name = exception.fullName ?? 'Kotlin exception'
  const message = exception.message ?? exception.localizedMessage ?? ''
  const stack = exception.stackTrace
    ?.slice(0, 8)
    .map((frame) => {
      const location = frame.fileName && frame.lineNumber && frame.lineNumber > 0 ? `(${frame.fileName}:${frame.lineNumber})` : ''
      return `  at ${frame.className ?? 'unknown'}.${frame.methodName ?? 'unknown'}${location}`
    })
    .join('\n')

  return [message ? `${name}: ${message}` : name, stack].filter(Boolean).join('\n')
}

function makeSafeCompilerFileName(path: string, index: number, usedNames: Set<string>): string {
  const fallbackName = `File${index + 1}.kt`
  const normalized = path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('_')
    .replace(/[^\w.-]/g, '_')
    .replace(/^_+/, '')

  const withExtension = normalized.toLocaleLowerCase('en').endsWith('.kt') ? normalized : `${normalized || fallbackName}.kt`
  const baseName = withExtension || fallbackName
  let candidate = baseName
  let duplicateIndex = 2

  while (usedNames.has(candidate)) {
    candidate = baseName.replace(/\.kt$/i, `_${duplicateIndex}.kt`)
    duplicateIndex += 1
  }

  usedNames.add(candidate)
  return candidate
}
