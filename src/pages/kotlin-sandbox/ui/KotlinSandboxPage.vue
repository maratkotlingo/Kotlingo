<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  completionKeymap,
  snippetCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { kotlin } from '@codemirror/legacy-modes/mode/clike'
import { Compartment, EditorState, type Extension, type Range } from '@codemirror/state'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  Loader2,
  Package,
  Play,
  RotateCcw,
  Search,
  Terminal,
  Trash2,
  Wand2,
  X,
} from '@lucide/vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import CourseTopBar from '@/widgets/course-layout/ui/CourseTopBar.vue'
import AppSelect from '@/shared/ui/AppSelect.vue'
import { buttons, form, layout, tagBase } from '@/shared/config/ui'
import {
  DEFAULT_ACTIVE_FILE_ID,
  ROOT_ID,
  createDefaultProject,
  createNodeId,
  formatKotlinCode,
  getDescendantIds,
  getNodePath,
  isFileNode,
  isFolderNode,
  makeUniqueNodeName,
  normalizeFileName,
  normalizeFolderName,
  packageNameFromFolder,
  parseKotlinDeclarations,
  parseKotlinImports,
  parseKotlinPackage,
  sortSandboxNodes,
  sourceForNewKotlinFile,
  type KotlinImport,
  type SandboxFileNode,
  type SandboxFolderNode,
  type SandboxNode,
} from '@/pages/kotlin-sandbox/model/sandboxProject'
import {
  FALLBACK_KOTLIN_VERSION,
  cleanCompilerText,
  fetchKotlinCompilerVersions,
  flattenCompilerDiagnostics,
  formatCompilerException,
  prepareCompilerProject,
  resolveLatestStableVersion,
  runKotlinProject,
  type KotlinCompilerVersion,
  type RuntimeDiagnostic,
} from '@/pages/kotlin-sandbox/model/kotlinCompiler'

type RunStatus = 'idle' | 'running' | 'success' | 'error'
type ImportStatus = 'resolved' | 'missing' | 'wildcard' | 'external'

interface SelectOption {
  label: string
  value: string
}

interface VisibleNode {
  node: SandboxNode
  depth: number
}

interface StoredSandboxState {
  nodes: SandboxNode[]
  activeFileId: string
  selectedNodeId: string
  openFileIds?: string[]
  expandedFolderIds: string[]
  compilerVersion: string
  args: string
}

interface ExportedSymbol {
  fileId: string
  filePath: string
  packageName: string
  importPath: string
  name: string
  kind: string
}

interface ImportResolution extends KotlinImport {
  status: ImportStatus
  targetFilePath?: string
}

interface CompletionQuery {
  from: number
  to: number
  prefix: string
  mode: 'default' | 'import' | 'member'
  qualifier?: string
}

interface InlineSuggestion {
  from: number
  to: number
  insertText: string
  suffix: string
}

const STORAGE_KEY = 'kotlingo.kotlin-sandbox.v1'
const LATEST_VERSION_VALUE = 'latest'
const defaultExpandedFolderIds = [ROOT_ID, 'folder-src', 'folder-playground']
const diagnosticsCompartment = new Compartment()

const nodes = ref<SandboxNode[]>(createDefaultProject())
const activeFileId = ref(DEFAULT_ACTIVE_FILE_ID)
const selectedNodeId = ref(DEFAULT_ACTIVE_FILE_ID)
const openFileIds = ref<string[]>([DEFAULT_ACTIVE_FILE_ID])
const expandedFolderIds = ref<string[]>([...defaultExpandedFolderIds])
const renameDraft = ref('')
const fileSearchQuery = ref('')
const draggedNodeId = ref('')
const dragTargetNodeId = ref('')
const compilerVersions = ref<KotlinCompilerVersion[]>([])
const compilerVersionsLoading = ref(false)
const compilerVersionsError = ref('')
const selectedCompilerVersion = ref(LATEST_VERSION_VALUE)
const programArgs = ref('')
const runStatus = ref<RunStatus>('idle')
const runOutput = ref('Нажмите «Запустить», чтобы собрать проект на актуальном Kotlin compiler backend.')
const diagnostics = ref<RuntimeDiagnostic[]>([])
const lastRunAt = ref('')
const copiedImportPath = ref('')
const editorHostRef = ref<HTMLElement | null>(null)
const editorView = shallowRef<EditorView | null>(null)
const hasHydrated = ref(false)

const nodeMap = computed(() => new Map(nodes.value.map((node) => [node.id, node])))
const files = computed(() => nodes.value.filter(isFileNode))
const folders = computed(() => nodes.value.filter(isFolderNode))
const activeFile = computed<SandboxFileNode | undefined>(
  () => files.value.find((file) => file.id === activeFileId.value) ?? files.value[0],
)
const selectedNode = computed(() => nodeMap.value.get(selectedNodeId.value) ?? activeFile.value)
const selectedFolder = computed<SandboxFolderNode | undefined>(() => {
  if (isFolderNode(selectedNode.value)) {
    return selectedNode.value
  }

  return nodeMap.value.get(activeFile.value?.parentId ?? ROOT_ID) as SandboxFolderNode | undefined
})
const activeFilePath = computed(() => (activeFile.value ? getNodePath(activeFile.value.id, nodes.value) : ''))
const activePackage = computed(() => parseKotlinPackage(activeFile.value?.content ?? ''))
const openFiles = computed(() =>
  openFileIds.value
    .map((fileId) => files.value.find((file) => file.id === fileId))
    .filter((file): file is SandboxFileNode => Boolean(file)),
)
const projectStats = computed(() => ({
  files: files.value.length,
  folders: Math.max(0, folders.value.length - 1),
}))
const normalizedFileSearchQuery = computed(() => fileSearchQuery.value.trim().toLocaleLowerCase('ru'))
const visibleNodes = computed<VisibleNode[]>(() => {
  const result: VisibleNode[] = []

  if (normalizedFileSearchQuery.value) {
    appendSearchVisibleChildren(ROOT_ID, 0, result)
  } else {
    appendVisibleChildren(ROOT_ID, 0, result)
  }

  return result
})
const visibleFileCount = computed(() => visibleNodes.value.filter((item) => isFileNode(item.node)).length)
const latestStableVersion = computed(() => resolveLatestStableVersion(compilerVersions.value))
const resolvedCompilerVersion = computed(() =>
  selectedCompilerVersion.value === LATEST_VERSION_VALUE ? latestStableVersion.value : selectedCompilerVersion.value,
)
const compilerVersionOptions = computed<SelectOption[]>(() => [
  {
    label: `Latest stable (${latestStableVersion.value || FALLBACK_KOTLIN_VERSION})`,
    value: LATEST_VERSION_VALUE,
  },
  ...compilerVersions.value.map((version) => ({
    label: version.latestStable ? `${version.version} stable` : version.version,
    value: version.version,
  })),
])
const localSymbols = computed<ExportedSymbol[]>(() =>
  files.value.flatMap((file) => {
    const packageName = parseKotlinPackage(file.content)

    return parseKotlinDeclarations(file.content).map((declaration) => ({
      fileId: file.id,
      filePath: getNodePath(file.id, nodes.value),
      packageName,
      importPath: packageName ? `${packageName}.${declaration.name}` : declaration.name,
      name: declaration.name,
      kind: declaration.kind,
    }))
  }),
)
const exportedSymbols = computed<ExportedSymbol[]>(() =>
  localSymbols.value.filter((symbol) => symbol.fileId !== activeFileId.value && symbol.packageName),
)
const currentImports = computed<ImportResolution[]>(() =>
  parseKotlinImports(activeFile.value?.content ?? '').map((importItem) => resolveImport(importItem)),
)
const unresolvedImports = computed(() => currentImports.value.filter((item) => item.status === 'missing'))
const compilerErrorCount = computed(() => diagnostics.value.filter((diagnostic) => diagnostic.severity === 'ERROR').length)
const canDeleteSelected = computed(() => Boolean(selectedNode.value && selectedNode.value.id !== ROOT_ID))

const kotlinHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#a78bfa', fontWeight: '800' },
  { tag: [tags.name, tags.variableName], color: '#f7fbff' },
  { tag: [tags.function(tags.variableName), tags.function(tags.name)], color: '#38f2c2', fontWeight: '800' },
  { tag: [tags.className, tags.typeName], color: '#fb7185', fontWeight: '800' },
  { tag: [tags.string, tags.special(tags.string)], color: '#fbbf24' },
  { tag: [tags.number, tags.bool, tags.null], color: '#60a5fa' },
  { tag: tags.comment, color: '#66758d', fontStyle: 'italic' },
  { tag: tags.operator, color: '#9aa8bd' },
])

const kotlingoEditorTheme = EditorView.theme(
  {
    '&': {
      minHeight: 'min(68vh, 760px)',
      backgroundColor: 'var(--color-app-soft)',
      color: 'var(--color-ink)',
      fontFamily: 'var(--font-mono)',
    },
    '.cm-scroller': {
      minHeight: 'min(68vh, 760px)',
      fontFamily: 'var(--font-mono)',
      fontSize: '14px',
      lineHeight: '1.5',
    },
    '.cm-content': {
      minHeight: 'min(68vh, 760px)',
      padding: '16px 0',
      caretColor: 'var(--color-accent)',
    },
    '.cm-line': {
      padding: '0 16px',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-app)',
      borderRight: '1px solid var(--color-line)',
      color: 'var(--color-muted-soft)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '44px',
      padding: '0 12px 0 8px',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgb(56 242 194 / 0.06)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgb(56 242 194 / 0.1)',
      color: 'var(--color-accent)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgb(56 242 194 / 0.22)',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--color-accent)',
    },
    '.cm-kotlingo-diagnostic-line-error': {
      backgroundColor: 'rgb(251 113 133 / 0.08)',
      boxShadow: 'inset 3px 0 0 var(--color-rose)',
    },
    '.cm-kotlingo-diagnostic-line-warning': {
      backgroundColor: 'rgb(251 191 36 / 0.07)',
      boxShadow: 'inset 3px 0 0 var(--color-amber)',
    },
    '.cm-kotlingo-diagnostic-mark-error': {
      textDecoration: 'underline wavy var(--color-rose)',
      textUnderlineOffset: '3px',
    },
    '.cm-kotlingo-diagnostic-mark-warning': {
      textDecoration: 'underline wavy var(--color-amber)',
      textUnderlineOffset: '3px',
    },
    '.cm-tooltip': {
      border: '1px solid var(--color-line)',
      borderRadius: 'var(--radius-card)',
      backgroundColor: 'var(--color-panel-raised)',
      color: 'var(--color-ink)',
      boxShadow: 'var(--shadow-panel)',
      overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete ul': {
      fontFamily: 'var(--font-sans)',
      maxHeight: '280px',
    },
    '.cm-tooltip-autocomplete ul li': {
      padding: '6px 10px',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'rgb(56 242 194 / 0.16)',
      color: 'var(--color-accent)',
    },
    '.cm-completionDetail': {
      color: 'var(--color-muted)',
      marginLeft: '12px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': {
      color: 'var(--color-ink)',
    },
    '.cm-kotlingo-inline-suggestion': {
      color: 'var(--color-muted-soft)',
      opacity: '0.72',
      pointerEvents: 'none',
    },
  },
  { dark: true },
)

const kotlinKeywords = [
  'as',
  'break',
  'class',
  'continue',
  'do',
  'else',
  'false',
  'for',
  'fun',
  'if',
  'in',
  'interface',
  'is',
  'null',
  'object',
  'package',
  'return',
  'super',
  'this',
  'throw',
  'true',
  'try',
  'typealias',
  'val',
  'var',
  'when',
  'while',
  'by',
  'catch',
  'constructor',
  'delegate',
  'dynamic',
  'field',
  'file',
  'finally',
  'get',
  'import',
  'init',
  'param',
  'property',
  'receiver',
  'set',
  'setparam',
  'where',
  'actual',
  'abstract',
  'annotation',
  'companion',
  'const',
  'crossinline',
  'data',
  'enum',
  'expect',
  'external',
  'final',
  'infix',
  'inline',
  'inner',
  'internal',
  'lateinit',
  'noinline',
  'open',
  'operator',
  'out',
  'override',
  'private',
  'protected',
  'public',
  'reified',
  'sealed',
  'suspend',
  'tailrec',
  'value',
  'vararg',
]

const kotlinStdlibCompletions: Completion[] = [
  'Any',
  'Unit',
  'Nothing',
  'String',
  'Char',
  'Boolean',
  'Byte',
  'Short',
  'Int',
  'Long',
  'Float',
  'Double',
  'Array',
  'IntArray',
  'LongArray',
  'List',
  'MutableList',
  'Set',
  'MutableSet',
  'Map',
  'MutableMap',
  'Pair',
  'Triple',
  'Result',
  'Sequence',
  'Iterable',
  'Comparable',
  'Comparator',
  'Throwable',
  'Exception',
  'IllegalArgumentException',
  'IllegalStateException',
  'println',
  'print',
  'readln',
  'readLine',
  'TODO',
  'require',
  'check',
  'error',
  'run',
  'let',
  'also',
  'apply',
  'with',
  'takeIf',
  'takeUnless',
  'lazy',
  'mutableListOf',
  'listOf',
  'setOf',
  'mutableSetOf',
  'mapOf',
  'mutableMapOf',
  'arrayOf',
  'sequenceOf',
  'generateSequence',
  'emptyList',
  'emptySet',
  'emptyMap',
  'buildList',
  'buildSet',
  'buildMap',
].map((label) => ({
  label,
  type: /^[A-Z]/.test(label) ? 'type' : 'function',
  detail: 'kotlin stdlib',
  section: 'Kotlin stdlib',
}))

const kotlinMemberCompletions: Completion[] = [
  'toString',
  'hashCode',
  'equals',
  'copy',
  'let',
  'also',
  'apply',
  'run',
  'takeIf',
  'takeUnless',
  'isNullOrBlank',
  'isNullOrEmpty',
  'isEmpty',
  'isNotEmpty',
  'isBlank',
  'isNotBlank',
  'length',
  'size',
  'indices',
  'first',
  'last',
  'firstOrNull',
  'lastOrNull',
  'map',
  'flatMap',
  'filter',
  'filterNot',
  'forEach',
  'fold',
  'reduce',
  'groupBy',
  'associateBy',
  'sorted',
  'sortedBy',
  'distinct',
  'joinToString',
  'contains',
  'count',
  'any',
  'all',
  'none',
  'sum',
  'sumOf',
  'minOrNull',
  'maxOrNull',
].map((label) => ({
  label,
  type: label === 'length' || label === 'size' || label === 'indices' ? 'property' : 'method',
  detail: 'member',
  section: 'Members',
}))

const kotlinSnippetCompletions: Completion[] = [
  snippetCompletion('fun main() {\n    ${}\n}', {
    label: 'main',
    detail: 'fun main',
    type: 'function',
    section: 'Snippets',
  }),
  snippetCompletion('println(${})', {
    label: 'println',
    detail: 'print line',
    type: 'function',
    section: 'Snippets',
    boost: 90,
  }),
  snippetCompletion('data class ${Name}(val ${property}: ${Type})', {
    label: 'data class',
    detail: 'data class',
    type: 'class',
    section: 'Snippets',
  }),
  snippetCompletion('class ${Name} {\n    ${}\n}', {
    label: 'class',
    detail: 'class block',
    type: 'class',
    section: 'Snippets',
  }),
  snippetCompletion('when (${value}) {\n    ${condition} -> ${result}\n    else -> ${fallback}\n}', {
    label: 'when',
    detail: 'when expression',
    type: 'keyword',
    section: 'Snippets',
  }),
  snippetCompletion('for (${item} in ${items}) {\n    ${}\n}', {
    label: 'for',
    detail: 'for loop',
    type: 'keyword',
    section: 'Snippets',
  }),
  snippetCompletion('if (${condition}) {\n    ${}\n}', {
    label: 'if',
    detail: 'if block',
    type: 'keyword',
    section: 'Snippets',
  }),
]

onMounted(() => {
  loadPersistedState()
  hasHydrated.value = true
  loadCompilerVersions()
  nextTick(mountEditor)
})

onBeforeUnmount(() => {
  editorView.value?.destroy()
  editorView.value = null
})

watch(
  [nodes, activeFileId, selectedNodeId, openFileIds, expandedFolderIds, selectedCompilerVersion, programArgs],
  () => {
    if (hasHydrated.value) {
      persistState()
    }
  },
  { deep: true },
)

watch(
  selectedNode,
  (node) => {
    renameDraft.value = node?.name ?? ''
  },
  { immediate: true },
)

watch(
  activeFile,
  (file) => {
    if (!file) {
      return
    }

    activeFileId.value = file.id
    openFile(file.id)
    replaceEditorDocument(file.content)

    if (!nodeMap.value.has(selectedNodeId.value)) {
      selectedNodeId.value = file.id
    }
  },
  { immediate: true },
)

watch(
  [diagnostics, activeFilePath],
  () => {
    reconfigureDiagnostics()
  },
  { deep: true },
)

function mountEditor() {
  if (!editorHostRef.value || editorView.value) {
    return
  }

  editorView.value = new EditorView({
    parent: editorHostRef.value,
    state: EditorState.create({
      doc: activeFile.value?.content ?? '',
      extensions: createEditorExtensions(),
    }),
  })
}

function createEditorExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    StreamLanguage.define(kotlin),
    syntaxHighlighting(kotlinHighlightStyle),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorState.tabSize.of(4),
    indentUnit.of('    '),
    placeholder('Создайте Kotlin-файл слева'),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setActiveFileContent(update.state.doc.toString())
      }
    }),
    autocompletion({
      activateOnTyping: true,
      activateOnTypingDelay: 0,
      maxRenderedOptions: 120,
      selectOnOpen: true,
      override: [localCompletionSource],
      optionClass: (completion) => `cm-kotlingo-completion-${completion.type ?? 'text'}`,
    }),
    createInlineSuggestionExtension(),
    diagnosticsCompartment.of(createDiagnosticsExtension()),
    keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          void runProject()
          return true
        },
      },
      {
        key: 'Mod-Shift-f',
        run: () => {
          formatActiveFile()
          return true
        },
      },
      {
        key: 'Tab',
        run: (view) => acceptInlineSuggestion(view) || acceptCompletion(view) || Boolean(indentWithTab.run?.(view)),
      },
      { key: 'Ctrl-Space', run: startCompletion },
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    kotlingoEditorTheme,
  ]
}

function localCompletionSource(context: CompletionContext): CompletionResult | null {
  const query = getCompletionQuery(context.state, context.pos)

  if (!query || (!query.prefix && !context.explicit && query.mode !== 'import')) {
    return null
  }

  return {
    from: query.from,
    to: query.to,
    options: buildCompletionOptions(query),
    validFor: query.mode === 'import' ? /^[A-Za-z_][\w.]*\*?$/ : /^[A-Za-z_]\w*$/,
  }
}

function getCompletionQuery(state: EditorState, pos: number): CompletionQuery | null {
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const importMatch = before.match(/^\s*import\s+([A-Za-z_][\w.]*\*?)?$/)

  if (importMatch) {
    const prefix = importMatch[1] ?? ''

    return {
      from: pos - prefix.length,
      to: pos,
      prefix,
      mode: 'import',
    }
  }

  const memberMatch = before.match(/([A-Za-z_]\w*)\.([A-Za-z_]\w*)?$/)

  if (memberMatch) {
    const prefix = memberMatch[2] ?? ''

    return {
      from: pos - prefix.length,
      to: pos,
      prefix,
      mode: 'member',
      qualifier: memberMatch[1],
    }
  }

  const wordMatch = before.match(/[A-Za-z_]\w*$/)

  if (!wordMatch) {
    return null
  }

  return {
    from: pos - wordMatch[0].length,
    to: pos,
    prefix: wordMatch[0],
    mode: 'default',
  }
}

function buildCompletionOptions(query: CompletionQuery): Completion[] {
  if (query.mode === 'import') {
    return buildImportCompletionOptions()
  }

  if (query.mode === 'member') {
    return buildMemberCompletionOptions(query.qualifier)
  }

  return [
    ...buildProjectCompletionOptions(),
    ...buildLocalScopeCompletionOptions(),
    ...kotlinSnippetCompletions,
    ...kotlinStdlibCompletions,
    ...kotlinKeywords.map((keyword) => ({
      label: keyword,
      type: 'keyword',
      detail: 'keyword',
      section: 'Keywords',
    })),
  ]
}

function buildProjectCompletionOptions(): Completion[] {
  const seenLabels = new Set<string>()

  return localSymbols.value.flatMap((symbol) => {
    const key = `${symbol.name}:${symbol.importPath}`

    if (seenLabels.has(key)) {
      return []
    }

    seenLabels.add(key)

    const needsImport = Boolean(
      symbol.packageName &&
      symbol.fileId !== activeFileId.value &&
      symbol.packageName !== activePackage.value &&
      !parseKotlinImports(activeFile.value?.content ?? '').some((importItem) => importItem.path === symbol.importPath),
    )

    return [
      {
        label: symbol.name,
        type: completionType(symbol.kind),
        detail: needsImport ? `${symbol.importPath} + import` : symbol.fileId === activeFileId.value ? symbol.kind : symbol.importPath,
        info: `${symbol.kind} ${symbol.importPath}\n${symbol.filePath}`,
        boost: symbol.fileId === activeFileId.value ? 120 : needsImport ? 85 : 70,
        section: symbol.fileId === activeFileId.value ? 'Current file' : 'Project',
        apply: needsImport ? (view, _completion, from, to) => applySymbolCompletionWithImport(view, symbol, from, to) : undefined,
      },
    ]
  })
}

function buildLocalScopeCompletionOptions(): Completion[] {
  const content = activeFile.value?.content ?? ''
  const symbols = new Map<string, Completion>()
  const localRegex = /\b(?:val|var)\s+([A-Za-z_]\w*)/g
  const parameterRegex = /fun\s+\w+\s*\(([^)]*)\)/g
  let match: RegExpExecArray | null

  while ((match = localRegex.exec(content)) !== null) {
    symbols.set(match[1], {
      label: match[1],
      type: 'variable',
      detail: 'local variable',
      boost: 140,
      section: 'Local scope',
    })
  }

  while ((match = parameterRegex.exec(content)) !== null) {
    match[1]
      .split(',')
      .map((parameter) => parameter.trim().match(/^([A-Za-z_]\w*)\s*:/)?.[1])
      .filter((parameter): parameter is string => Boolean(parameter))
      .forEach((parameter) => {
        symbols.set(parameter, {
          label: parameter,
          type: 'variable',
          detail: 'parameter',
          boost: 135,
          section: 'Local scope',
        })
      })
  }

  return Array.from(symbols.values())
}

function buildImportCompletionOptions(): Completion[] {
  const packageNames = new Set(exportedSymbols.value.map((symbol) => symbol.packageName).filter(Boolean))
  const packageOptions: Completion[] = Array.from(packageNames).flatMap((packageName) => [
    {
      label: `${packageName}.*`,
      type: 'namespace',
      detail: 'project package',
      boost: 80,
      section: 'Packages',
    },
    {
      label: packageName,
      type: 'namespace',
      detail: 'package',
      boost: 40,
      section: 'Packages',
    },
  ])

  return [
    ...exportedSymbols.value.map((symbol) => ({
      label: symbol.importPath,
      type: completionType(symbol.kind),
      detail: symbol.filePath,
      boost: 100,
      section: 'Project imports',
    })),
    ...packageOptions,
    ...['kotlin.collections.*', 'kotlin.math.*', 'kotlin.text.*', 'java.time.*', 'java.io.File', 'java.math.BigDecimal'].map(
      (label) => ({
        label,
        type: label.endsWith('.*') ? 'namespace' : 'type',
        detail: 'common import',
        section: 'Common imports',
      }),
    ),
  ]
}

function buildMemberCompletionOptions(qualifier?: string): Completion[] {
  const localClass = localSymbols.value.find((symbol) => symbol.name === qualifier && ['class', 'object'].includes(symbol.kind))
  const classMemberOptions = localClass ? extractClassMemberCompletions(localClass) : []

  return [...classMemberOptions, ...kotlinMemberCompletions]
}

function extractClassMemberCompletions(symbol: ExportedSymbol): Completion[] {
  const file = files.value.find((item) => item.id === symbol.fileId)

  if (!file) {
    return []
  }

  const classRegex = new RegExp(`\\b(?:class|object|interface)\\s+${escapeRegExp(symbol.name)}\\b[^{]*\\{([\\s\\S]*)\\}`)
  const body = file.content.match(classRegex)?.[1] ?? ''

  return parseKotlinDeclarations(body).map((declaration) => ({
    label: declaration.name,
    type: completionType(declaration.kind),
    detail: `${symbol.name}.${declaration.name}`,
    boost: 130,
    section: 'Class members',
  }))
}

function createDiagnosticsExtension(): Extension {
  const activePath = activeFilePath.value
  const activeDiagnostics = diagnostics.value.filter((diagnostic) => diagnostic.filePath === activePath)

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDiagnosticDecorations(view, activeDiagnostics)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDiagnosticDecorations(update.view, activeDiagnostics)
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  )
}

function buildDiagnosticDecorations(view: EditorView, activeDiagnostics: RuntimeDiagnostic[]): DecorationSet {
  const ranges: Range<Decoration>[] = []

  activeDiagnostics.forEach((diagnostic) => {
    const lineNumber = diagnostic.line ?? (diagnostic.interval ? diagnostic.interval.start.line + 1 : undefined)

    if (!lineNumber || lineNumber < 1 || lineNumber > view.state.doc.lines) {
      return
    }

    const line = view.state.doc.line(lineNumber)
    const severityClass = diagnostic.severity === 'ERROR' ? 'error' : 'warning'

    ranges.push(
      Decoration.line({
        class: `cm-kotlingo-diagnostic-line cm-kotlingo-diagnostic-line-${severityClass}`,
        attributes: { title: diagnostic.message },
      }).range(line.from),
    )

    if (!diagnostic.interval) {
      return
    }

    const startLine = view.state.doc.line(Math.min(view.state.doc.lines, diagnostic.interval.start.line + 1))
    const endLine = view.state.doc.line(Math.min(view.state.doc.lines, diagnostic.interval.end.line + 1))
    const from = Math.min(startLine.from + diagnostic.interval.start.ch, view.state.doc.length)
    const endCandidate = endLine.from + Math.max(diagnostic.interval.end.ch, diagnostic.interval.start.ch + 1)
    const to = Math.max(from + 1, Math.min(endCandidate, view.state.doc.length))

    ranges.push(
      Decoration.mark({
        class: `cm-kotlingo-diagnostic-mark cm-kotlingo-diagnostic-mark-${severityClass}`,
        attributes: { title: diagnostic.message },
      }).range(from, to),
    )
  })

  return Decoration.set(ranges, true)
}

function reconfigureDiagnostics() {
  editorView.value?.dispatch({
    effects: diagnosticsCompartment.reconfigure(createDiagnosticsExtension()),
  })
}

function replaceEditorDocument(content: string) {
  const view = editorView.value

  if (!view || view.state.doc.toString() === content) {
    return
  }

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  })
}

function setActiveFileContent(content: string) {
  const file = activeFile.value

  if (!file || file.content === content) {
    return
  }

  nodes.value = nodes.value.map((node) => (node.id === file.id ? { ...node, content } : node))
}

function completionType(kind: string): string {
  const types: Record<string, string> = {
    class: 'class',
    interface: 'interface',
    object: 'constant',
    fun: 'function',
    val: 'variable',
    var: 'variable',
    typealias: 'type',
  }

  return types[kind] ?? 'text'
}

function applySymbolCompletionWithImport(view: EditorView, symbol: ExportedSymbol, from: number, to: number) {
  const importLine = `import ${symbol.importPath}\n`
  const importPosition = importInsertPosition(view.state.doc.toString())

  view.dispatch({ changes: { from: importPosition, insert: importLine } })

  const shift = importPosition <= from ? importLine.length : 0
  view.dispatch({
    changes: { from: from + shift, to: to + shift, insert: symbol.name },
    selection: { anchor: from + shift + symbol.name.length },
  })
}

function importInsertPosition(content: string): number {
  const lines = content.split('\n')
  let offset = 0
  let lastImportEnd = -1
  let packageEnd = -1

  lines.forEach((line) => {
    const lineEnd = offset + line.length + 1

    if (/^\s*package\s+/.test(line)) {
      packageEnd = lineEnd
    }

    if (/^\s*import\s+/.test(line)) {
      lastImportEnd = lineEnd
    }

    offset = lineEnd
  })

  if (lastImportEnd >= 0) {
    return lastImportEnd
  }

  if (packageEnd >= 0) {
    return packageEnd < content.length && content[packageEnd] === '\n' ? packageEnd + 1 : packageEnd
  }

  return 0
}

function createInlineSuggestionExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildInlineSuggestionDecorations(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
          this.decorations = buildInlineSuggestionDecorations(update.view)
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  )
}

function buildInlineSuggestionDecorations(view: EditorView): DecorationSet {
  const suggestion = bestInlineSuggestion(view.state)

  if (!suggestion || !view.hasFocus) {
    return Decoration.none
  }

  return Decoration.set([
    Decoration.widget({
      widget: new InlineSuggestionWidget(suggestion.suffix),
      side: 1,
    }).range(suggestion.to),
  ])
}

function bestInlineSuggestion(state: EditorState): InlineSuggestion | null {
  const range = state.selection.main

  if (!range.empty) {
    return null
  }

  const query = getCompletionQuery(state, range.head)

  if (!query || !query.prefix || query.mode === 'member') {
    return null
  }

  const option = rankCompletionOptions(buildCompletionOptions(query), query.prefix)[0]
  const insertText = completionInsertText(option)

  if (!option || !insertText.toLocaleLowerCase('en').startsWith(query.prefix.toLocaleLowerCase('en'))) {
    return null
  }

  const suffix = insertText.slice(query.prefix.length)

  if (!suffix) {
    return null
  }

  return {
    from: query.from,
    to: query.to,
    insertText,
    suffix,
  }
}

function acceptInlineSuggestion(view: EditorView): boolean {
  const suggestion = bestInlineSuggestion(view.state)

  if (!suggestion) {
    return false
  }

  view.dispatch({
    changes: { from: suggestion.from, to: suggestion.to, insert: suggestion.insertText },
    selection: { anchor: suggestion.from + suggestion.insertText.length },
  })

  return true
}

function completionInsertText(completion: Completion | undefined): string {
  if (!completion) {
    return ''
  }

  return typeof completion.apply === 'string' ? completion.apply : completion.label
}

function rankCompletionOptions(options: Completion[], prefix: string): Completion[] {
  return [...options]
    .filter((option) => fuzzyCompletionScore(completionInsertText(option), prefix) > 0)
    .sort((first, second) => {
      const firstScore = fuzzyCompletionScore(completionInsertText(first), prefix) + (first.boost ?? 0)
      const secondScore = fuzzyCompletionScore(completionInsertText(second), prefix) + (second.boost ?? 0)

      return secondScore - firstScore || first.label.localeCompare(second.label, 'en')
    })
}

function fuzzyCompletionScore(candidate: string, prefix: string): number {
  const normalizedCandidate = candidate.toLocaleLowerCase('en')
  const normalizedPrefix = prefix.toLocaleLowerCase('en')

  if (!normalizedPrefix) {
    return 1
  }

  if (normalizedCandidate === normalizedPrefix) {
    return 500
  }

  if (normalizedCandidate.startsWith(normalizedPrefix)) {
    return 420 - normalizedCandidate.length
  }

  if (normalizedCandidate.includes(normalizedPrefix)) {
    return 260 - normalizedCandidate.indexOf(normalizedPrefix)
  }

  let candidateIndex = 0
  let score = 120

  for (const char of normalizedPrefix) {
    const foundIndex = normalizedCandidate.indexOf(char, candidateIndex)

    if (foundIndex === -1) {
      return 0
    }

    score -= foundIndex - candidateIndex
    candidateIndex = foundIndex + 1
  }

  return Math.max(1, score)
}

class InlineSuggestionWidget extends WidgetType {
  private readonly text: string

  constructor(text: string) {
    super()
    this.text = text
  }

  eq(other: InlineSuggestionWidget): boolean {
    return other.text === this.text
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-kotlingo-inline-suggestion'
    element.textContent = this.text

    return element
  }

  ignoreEvent(): boolean {
    return true
  }
}

function openFile(fileId: string) {
  if (!openFileIds.value.includes(fileId)) {
    openFileIds.value = [...openFileIds.value, fileId]
  }
}

function activateFile(fileId: string) {
  const file = files.value.find((item) => item.id === fileId)

  if (!file) {
    return
  }

  selectedNodeId.value = file.id
  activeFileId.value = file.id
  openFile(file.id)
}

function closeFileTab(fileId: string) {
  const currentIndex = openFileIds.value.indexOf(fileId)
  const nextOpenFileIds = openFileIds.value.filter((id) => id !== fileId)

  openFileIds.value = nextOpenFileIds

  if (activeFileId.value !== fileId) {
    return
  }

  const fallbackFileId = nextOpenFileIds[Math.max(0, currentIndex - 1)] ?? nextOpenFileIds[0] ?? files.value[0]?.id

  if (fallbackFileId) {
    activateFile(fallbackFileId)
  }
}

function formatActiveFile() {
  const file = activeFile.value

  if (!file) {
    return
  }

  const formatted = formatKotlinCode(file.content)
  setActiveFileContent(formatted)
  replaceEditorDocument(formatted)
}

function revealDiagnostic(diagnostic: RuntimeDiagnostic) {
  const targetFile = files.value.find((file) => getNodePath(file.id, nodes.value) === diagnostic.filePath)

  if (!targetFile) {
    return
  }

  activateFile(targetFile.id)

  nextTick(() => {
    const view = editorView.value
    const lineNumber = diagnostic.line ?? 1

    if (!view || lineNumber < 1 || lineNumber > view.state.doc.lines) {
      return
    }

    const line = view.state.doc.line(lineNumber)
    const anchor = Math.min(line.to, line.from + Math.max(0, (diagnostic.column ?? 1) - 1))

    view.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
    })
    view.focus()
  })
}

function appendVisibleChildren(parentId: string, depth: number, result: VisibleNode[]) {
  nodes.value
    .filter((node) => node.parentId === parentId)
    .sort(sortSandboxNodes)
    .forEach((node) => {
      result.push({ node, depth })

      if (isFolderNode(node) && expandedFolderIds.value.includes(node.id)) {
        appendVisibleChildren(node.id, depth + 1, result)
      }
    })
}

function appendSearchVisibleChildren(parentId: string, depth: number, result: VisibleNode[]) {
  nodes.value
    .filter((node) => node.parentId === parentId)
    .sort(sortSandboxNodes)
    .forEach((node) => {
      const matches = nodeMatchesFileSearch(node)
      const hasMatchingChildren = isFolderNode(node) && folderHasSearchMatch(node.id)

      if (!matches && !hasMatchingChildren) {
        return
      }

      result.push({ node, depth })

      if (isFolderNode(node)) {
        appendSearchVisibleChildren(node.id, depth + 1, result)
      }
    })
}

function nodeMatchesFileSearch(node: SandboxNode): boolean {
  const query = normalizedFileSearchQuery.value

  if (!query) {
    return true
  }

  const path = getNodePath(node.id, nodes.value).toLocaleLowerCase('ru')
  const name = node.name.toLocaleLowerCase('ru')
  const content = isFileNode(node) ? node.content.toLocaleLowerCase('ru') : ''

  return name.includes(query) || path.includes(query) || content.includes(query)
}

function folderHasSearchMatch(folderId: string): boolean {
  return getDescendantIds(folderId, nodes.value).some((nodeId) => {
    const node = nodeMap.value.get(nodeId)

    return Boolean(node && nodeMatchesFileSearch(node))
  })
}

function selectNode(node: SandboxNode) {
  selectedNodeId.value = node.id

  if (isFileNode(node)) {
    activeFileId.value = node.id
    return
  }

  toggleFolder(node.id)
}

function handleTreeDragStart(event: DragEvent, node: SandboxNode) {
  if (node.id === ROOT_ID) {
    return
  }

  draggedNodeId.value = node.id
  event.dataTransfer?.setData('text/plain', node.id)
  event.dataTransfer?.setData('application/x-kotlingo-node', node.id)

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function handleTreeDragOver(event: DragEvent, targetNode: SandboxNode) {
  const draggedNode = nodeMap.value.get(draggedNodeId.value)
  const targetParentId = dropParentIdForNode(targetNode)

  if (!draggedNode || !targetParentId || !canMoveNode(draggedNode, targetParentId)) {
    return
  }

  event.preventDefault()
  dragTargetNodeId.value = targetNode.id

  if (isFolderNode(targetNode)) {
    expandFolder(targetNode.id)
  }
}

function handleTreeDrop(event: DragEvent, targetNode: SandboxNode) {
  event.preventDefault()

  const draggedNode = nodeMap.value.get(draggedNodeId.value)
  const targetParentId = dropParentIdForNode(targetNode)

  if (draggedNode && targetParentId && canMoveNode(draggedNode, targetParentId)) {
    moveNodeToFolder(draggedNode, targetParentId)
  }

  clearTreeDragState()
}

function clearTreeDragState() {
  draggedNodeId.value = ''
  dragTargetNodeId.value = ''
}

function dropParentIdForNode(node: SandboxNode): string | null {
  return isFolderNode(node) ? node.id : node.parentId
}

function canMoveNode(node: SandboxNode, targetParentId: string): boolean {
  if (node.id === ROOT_ID || node.parentId === targetParentId || node.id === targetParentId) {
    return false
  }

  if (isFolderNode(node) && getDescendantIds(node.id, nodes.value).includes(targetParentId)) {
    return false
  }

  return Boolean(nodeMap.value.get(targetParentId))
}

function moveNodeToFolder(node: SandboxNode, targetParentId: string) {
  const uniqueName = makeUniqueNodeName(targetParentId, nodes.value, node.name, node.id)

  nodes.value = nodes.value.map((item) =>
    item.id === node.id
      ? {
          ...item,
          parentId: targetParentId,
          name: uniqueName,
        }
      : item,
  )
  selectedNodeId.value = node.id
  expandFolder(targetParentId)
}

function toggleFolder(folderId: string) {
  if (expandedFolderIds.value.includes(folderId)) {
    expandedFolderIds.value = expandedFolderIds.value.filter((id) => id !== folderId)
  } else {
    expandedFolderIds.value = [...expandedFolderIds.value, folderId]
  }
}

function createFile() {
  const parentId = selectedFolder.value?.id ?? ROOT_ID
  const packageName = packageNameFromFolder(parentId, nodes.value)
  const name = makeUniqueNodeName(parentId, nodes.value, normalizeFileName('File.kt'))
  const file: SandboxFileNode = {
    id: createNodeId('file'),
    parentId,
    name,
    kind: 'file',
    content: sourceForNewKotlinFile(packageName),
  }

  nodes.value = [...nodes.value, file]
  selectedNodeId.value = file.id
  activeFileId.value = file.id
  expandFolder(parentId)
}

function createFolder() {
  const parentId = selectedFolder.value?.id ?? ROOT_ID
  const name = makeUniqueNodeName(parentId, nodes.value, normalizeFolderName('folder'))
  const folder: SandboxFolderNode = {
    id: createNodeId('folder'),
    parentId,
    name,
    kind: 'folder',
  }

  nodes.value = [...nodes.value, folder]
  selectedNodeId.value = folder.id
  expandFolder(parentId)
}

function deleteSelectedNode() {
  const node = selectedNode.value

  if (!node || node.id === ROOT_ID || !window.confirm(`Удалить ${node.name}?`)) {
    return
  }

  const deleteIds = new Set([node.id, ...(isFolderNode(node) ? getDescendantIds(node.id, nodes.value) : [])])
  nodes.value = nodes.value.filter((item) => !deleteIds.has(item.id))
  expandedFolderIds.value = expandedFolderIds.value.filter((id) => !deleteIds.has(id))
  openFileIds.value = openFileIds.value.filter((id) => !deleteIds.has(id))

  const nextFile = files.value.find((file) => !deleteIds.has(file.id))
  selectedNodeId.value = nextFile?.id ?? ROOT_ID
  activeFileId.value = nextFile?.id ?? ''

  if (nextFile && openFileIds.value.length === 0) {
    openFileIds.value = [nextFile.id]
  }
}

function commitRename() {
  const node = selectedNode.value

  if (!node || node.id === ROOT_ID) {
    return
  }

  const parentId = node.parentId ?? ROOT_ID
  const normalizedName = isFileNode(node) ? normalizeFileName(renameDraft.value) : normalizeFolderName(renameDraft.value)
  const uniqueName = makeUniqueNodeName(parentId, nodes.value, normalizedName, node.id)

  nodes.value = nodes.value.map((item) => (item.id === node.id ? { ...item, name: uniqueName } : item))
  renameDraft.value = uniqueName
}

async function runProject() {
  if (runStatus.value === 'running') {
    return
  }

  runStatus.value = 'running'
  diagnostics.value = []
  runOutput.value = 'Compiling...'

  try {
    const version = await ensureCompilerVersion()
    const preparedProject = prepareCompilerProject(
      files.value.map((file) => ({
        path: getNodePath(file.id, nodes.value),
        content: file.content,
      })),
    )
    const response = await runKotlinProject(preparedProject.files, version, programArgs.value)
    const nextDiagnostics = flattenCompilerDiagnostics(response, preparedProject.fileNameToPath)
    const compilerText = cleanCompilerText(response.text)
    const exceptionText = formatCompilerException(response.exception)
    const hasErrors = nextDiagnostics.some((diagnostic) => diagnostic.severity === 'ERROR') || Boolean(response.exception)

    diagnostics.value = nextDiagnostics
    runOutput.value = [compilerText, exceptionText].filter(Boolean).join('\n') || 'Program finished without output.'
    runStatus.value = hasErrors ? 'error' : 'success'
    lastRunAt.value = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch (error) {
    diagnostics.value = []
    runStatus.value = 'error'
    runOutput.value = error instanceof Error ? error.message : 'Kotlin compiler request failed.'
  }
}

async function ensureCompilerVersion(): Promise<string> {
  if (selectedCompilerVersion.value !== LATEST_VERSION_VALUE) {
    return selectedCompilerVersion.value
  }

  if (compilerVersions.value.length === 0) {
    await loadCompilerVersions()
  }

  return latestStableVersion.value || FALLBACK_KOTLIN_VERSION
}

async function loadCompilerVersions() {
  compilerVersionsLoading.value = true
  compilerVersionsError.value = ''

  try {
    compilerVersions.value = await fetchKotlinCompilerVersions()
  } catch (error) {
    compilerVersionsError.value = error instanceof Error ? error.message : 'Не удалось загрузить версии Kotlin.'
  } finally {
    compilerVersionsLoading.value = false
  }
}

function resolveImport(importItem: KotlinImport): ImportResolution {
  if (importItem.path.endsWith('.*')) {
    const packageName = importItem.path.slice(0, -2)
    const hasLocalPackage = exportedSymbols.value.some((symbol) => symbol.packageName === packageName)

    return {
      ...importItem,
      status: hasLocalPackage || isKnownExternalImport(importItem.path) ? 'wildcard' : 'missing',
    }
  }

  const localSymbol = exportedSymbols.value.find((symbol) => symbol.importPath === importItem.path)

  if (localSymbol) {
    return {
      ...importItem,
      status: 'resolved',
      targetFilePath: localSymbol.filePath,
    }
  }

  return {
    ...importItem,
    status: isKnownExternalImport(importItem.path) ? 'external' : 'missing',
  }
}

function insertImport(importPath: string) {
  const file = activeFile.value

  if (!file || parseKotlinImports(file.content).some((importItem) => importItem.path === importPath)) {
    return
  }

  const lines = file.content.split('\n')
  let insertIndex = 0
  let lastImportIndex = -1

  lines.forEach((line, index) => {
    if (/^\s*import\s+/.test(line)) {
      lastImportIndex = index
    }
  })

  if (lastImportIndex >= 0) {
    insertIndex = lastImportIndex + 1
  } else if (/^\s*package\s+/.test(lines[0] ?? '')) {
    insertIndex = lines[1] === '' ? 2 : 1
  }

  lines.splice(insertIndex, 0, `import ${importPath}`)
  nodes.value = nodes.value.map((node) => (node.id === file.id ? { ...node, content: lines.join('\n') } : node))
}

async function copyImport(importPath: string) {
  await navigator.clipboard?.writeText(`import ${importPath}`)
  copiedImportPath.value = importPath
  window.setTimeout(() => {
    if (copiedImportPath.value === importPath) {
      copiedImportPath.value = ''
    }
  }, 1400)
}

function resetProject() {
  if (!window.confirm('Сбросить песочницу к начальному примеру?')) {
    return
  }

  nodes.value = createDefaultProject()
  activeFileId.value = DEFAULT_ACTIVE_FILE_ID
  selectedNodeId.value = DEFAULT_ACTIVE_FILE_ID
  openFileIds.value = [DEFAULT_ACTIVE_FILE_ID]
  expandedFolderIds.value = [...defaultExpandedFolderIds]
  runStatus.value = 'idle'
  diagnostics.value = []
  runOutput.value = 'Нажмите «Запустить», чтобы собрать проект на актуальном Kotlin compiler backend.'
}

function expandFolder(folderId: string) {
  if (!expandedFolderIds.value.includes(folderId)) {
    expandedFolderIds.value = [...expandedFolderIds.value, folderId]
  }
}

function treeNodeStyle(depth: number) {
  return { paddingLeft: `${10 + depth * 16}px` }
}

function importStatusLabel(status: ImportStatus): string {
  const labels: Record<ImportStatus, string> = {
    resolved: 'local',
    external: 'sdk',
    wildcard: 'package',
    missing: 'missing',
  }

  return labels[status]
}

function importStatusClass(status: ImportStatus): string {
  if (status === 'missing') {
    return 'inline-flex min-h-6 items-center rounded-full bg-rose/12 px-2 text-[11px] font-black text-rose'
  }

  if (status === 'external') {
    return tagBase.middle
  }

  return tagBase.beginner
}

function diagnosticClass(severity: string): string {
  return severity === 'ERROR'
    ? 'border-rose/35 bg-rose/10 text-rose'
    : 'border-amber/35 bg-amber/10 text-amber'
}

function isKnownExternalImport(importPath: string): boolean {
  return ['kotlin.', 'java.', 'javax.'].some((prefix) => importPath.startsWith(prefix))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function loadPersistedState() {
  const rawState = window.localStorage.getItem(STORAGE_KEY)

  if (!rawState) {
    return
  }

  try {
    const state = JSON.parse(rawState) as StoredSandboxState

    if (!isStoredStateValid(state)) {
      return
    }

    nodes.value = state.nodes
    activeFileId.value = state.activeFileId
    selectedNodeId.value = state.selectedNodeId
    openFileIds.value = state.openFileIds?.filter((fileId) => state.nodes.some((node) => node.id === fileId && node.kind === 'file')) ?? [
      state.activeFileId,
    ]
    expandedFolderIds.value = state.expandedFolderIds
    selectedCompilerVersion.value = state.compilerVersion
    programArgs.value = state.args
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
  }
}

function persistState() {
  const state: StoredSandboxState = {
    nodes: nodes.value,
    activeFileId: activeFileId.value,
    selectedNodeId: selectedNodeId.value,
    openFileIds: openFileIds.value,
    expandedFolderIds: expandedFolderIds.value,
    compilerVersion: selectedCompilerVersion.value,
    args: programArgs.value,
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function isStoredStateValid(state: StoredSandboxState): boolean {
  return (
    Array.isArray(state.nodes) &&
    state.nodes.some((node) => node.id === ROOT_ID && node.kind === 'folder') &&
    state.nodes.some(isFileNode) &&
    typeof state.activeFileId === 'string' &&
    typeof state.selectedNodeId === 'string' &&
    Array.isArray(state.expandedFolderIds)
  )
}
</script>

<template>
  <div :class="layout.page">
    <CourseTopBar>
      <div class="flex min-w-0 items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-card border border-accent/35 bg-accent/15 text-accent shadow-glow max-sm:h-8 max-sm:w-8">
          <Code2 :size="22" />
        </div>
        <div class="min-w-0">
          <p class="m-0 text-[11px] font-black uppercase tracking-wide text-muted max-sm:hidden">Kotlin browser IDE</p>
          <h1 class="m-0 truncate text-2xl font-black leading-none max-sm:text-xl">Песочница Kotlin</h1>
        </div>
      </div>

      <div class="grid min-w-0 gap-1 text-sm font-extrabold text-muted max-lg:hidden">
        <span>{{ projectStats.files }} файлов / {{ projectStats.folders }} папок</span>
        <span class="truncate text-xs text-muted-soft">Compiler {{ resolvedCompilerVersion || FALLBACK_KOTLIN_VERSION }}</span>
      </div>

      <div class="flex items-center gap-2">
        <RouterLink to="/" :class="[buttons.secondary, 'hidden xl:inline-flex']">
          <Home :size="18" />
          <span>Главная</span>
        </RouterLink>
        <RouterLink to="/kotlin" :class="[buttons.secondary, 'hidden sm:inline-flex']">
          <span>Kotlin курс</span>
        </RouterLink>
        <Button :class="buttons.primary" :disabled="runStatus === 'running'" title="Запустить проект" @click="runProject">
          <Loader2 v-if="runStatus === 'running'" class="animate-spin" :size="18" />
          <Play v-else :size="18" />
          <span class="max-sm:hidden">Запустить</span>
        </Button>
      </div>
    </CourseTopBar>

    <div class="mx-auto grid w-full max-w-[var(--page-max)] grid-cols-[300px_minmax(0,1fr)] items-start gap-5 px-6 py-5 pb-12 max-xl:block max-xl:px-3">
      <aside :class="[layout.panel, 'sticky top-[92px] flex max-h-[calc(100vh-112px)] flex-col overflow-hidden max-xl:static max-xl:max-h-none']">
        <div class="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Project</p>
            <strong class="text-lg font-black">Файлы</strong>
          </div>
          <div class="flex items-center gap-2">
            <Button :class="buttons.icon" title="Создать папку" aria-label="Создать папку" @click="createFolder">
              <FolderPlus :size="18" />
            </Button>
            <Button :class="buttons.icon" title="Создать файл" aria-label="Создать файл" @click="createFile">
              <FilePlus2 :size="18" />
            </Button>
          </div>
        </div>

        <div class="grid gap-2 border-b border-line px-4 py-3">
          <label :class="form.search">
            <Search :size="17" />
            <InputText v-model="fileSearchQuery" :class="form.input" placeholder="Поиск по файлам" />
          </label>
          <span v-if="normalizedFileSearchQuery" class="text-xs font-bold text-muted">
            {{ visibleFileCount }} совпадений
          </span>
        </div>

        <nav class="grid gap-1 overflow-auto p-2" aria-label="Файлы песочницы" @dragend="clearTreeDragState">
          <button
            v-for="item in visibleNodes"
            :key="item.node.id"
            :class="[
              'grid min-h-10 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-card border py-2 pr-2 text-left transition',
              selectedNode?.id === item.node.id
                ? 'border-accent/45 bg-accent/12 text-ink'
                : dragTargetNodeId === item.node.id
                  ? 'border-accent/60 bg-accent/10 text-ink shadow-glow'
                : 'border-transparent text-ink/78 hover:border-line hover:bg-panel-soft',
            ]"
            :style="treeNodeStyle(item.depth)"
            :draggable="item.node.id !== ROOT_ID"
            type="button"
            @dragstart="handleTreeDragStart($event, item.node)"
            @dragover="handleTreeDragOver($event, item.node)"
            @dragleave="dragTargetNodeId = ''"
            @drop="handleTreeDrop($event, item.node)"
            @click="selectNode(item.node)"
          >
            <ChevronDown v-if="isFolderNode(item.node) && expandedFolderIds.includes(item.node.id)" class="text-muted" :size="16" />
            <ChevronRight v-else-if="isFolderNode(item.node)" class="text-muted" :size="16" />
            <FileCode2 v-else class="text-accent" :size="16" />
            <span class="flex min-w-0 items-center gap-2">
              <FolderOpen v-if="isFolderNode(item.node) && expandedFolderIds.includes(item.node.id)" class="text-amber" :size="16" />
              <Folder v-else-if="isFolderNode(item.node)" class="text-amber" :size="16" />
              <span class="truncate text-sm font-bold">{{ item.node.name }}</span>
            </span>
          </button>
        </nav>

        <div class="grid gap-3 border-t border-line p-4">
          <div class="grid gap-2">
            <label class="text-xs font-black uppercase tracking-wide text-muted" for="sandbox-node-name">Имя</label>
            <InputText
              id="sandbox-node-name"
              v-model="renameDraft"
              class="min-h-10 rounded-control border border-line bg-app-soft px-3 text-sm font-bold text-ink outline-none transition focus:border-accent/60"
              :disabled="!selectedNode || selectedNode.id === ROOT_ID"
              @blur="commitRename"
              @keydown.enter.prevent="commitRename"
            />
          </div>
          <Button :class="[buttons.secondary, 'justify-center text-rose hover:border-rose/45 hover:bg-rose/10']" :disabled="!canDeleteSelected" @click="deleteSelectedNode">
            <Trash2 :size="17" />
            <span>Удалить</span>
          </Button>
        </div>
      </aside>

      <main class="grid min-w-0 gap-4 max-xl:mt-4">
        <section :class="[layout.panel, 'min-w-0 overflow-hidden']">
        <header class="flex items-center justify-between gap-4 border-b border-line px-5 py-4 max-sm:flex-col max-sm:items-start">
          <div class="min-w-0">
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Active file</p>
            <h2 class="m-0 mt-1 truncate text-2xl font-black">{{ activeFilePath || 'No file selected' }}</h2>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Tag v-if="activePackage" :value="activePackage" :class="tagBase.beginner" />
            <Tag v-else value="default package" :class="tagBase.default" />
            <Button :class="buttons.secondary" title="Форматировать код" @click="formatActiveFile">
              <Wand2 :size="17" />
              <span>Форматировать</span>
            </Button>
          </div>
        </header>

        <div class="flex min-h-12 items-center gap-1 overflow-x-auto border-b border-line bg-app-soft px-2 py-2">
          <div
            v-for="file in openFiles"
            :key="file.id"
            :class="[
              'grid min-w-40 grid-cols-[minmax(0,1fr)_30px] items-center overflow-hidden rounded-card border transition',
              file.id === activeFile?.id
                ? 'border-accent/45 bg-accent/12 text-ink'
                : 'border-line bg-panel hover:border-line-strong hover:bg-panel-soft',
            ]"
          >
            <button class="flex min-w-0 items-center gap-2 px-3 py-2 text-left" type="button" @click="activateFile(file.id)">
              <FileCode2 class="text-accent" :size="15" />
              <span class="truncate text-sm font-black">{{ file.name }}</span>
            </button>
            <button
              class="grid h-full place-items-center text-muted transition hover:bg-rose/10 hover:text-rose"
              type="button"
              title="Закрыть вкладку"
              aria-label="Закрыть вкладку"
              @click.stop="closeFileTab(file.id)"
            >
              <X :size="15" />
            </button>
          </div>
          <div v-if="openFiles.length === 0" class="px-3 text-sm font-bold text-muted">Откройте файл из дерева проекта</div>
        </div>

        <div class="overflow-hidden bg-app-soft">
          <div ref="editorHostRef" class="min-h-[min(68vh,760px)]"></div>
        </div>
        </section>

        <section :class="[layout.panel, 'grid gap-4 p-4']">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Run</p>
              <h2 class="m-0 mt-1 text-xl font-black">Компилятор</h2>
            </div>
            <Terminal class="text-accent" :size="22" />
          </div>

          <div class="grid gap-3">
            <AppSelect v-model="selectedCompilerVersion" :options="compilerVersionOptions" />
            <label :class="[form.search, 'grid-cols-[20px_minmax(0,1fr)]']">
              <Package :size="17" />
              <InputText v-model="programArgs" :class="form.input" placeholder="args для main" />
            </label>
            <Button :class="[buttons.primary, 'w-full']" :disabled="runStatus === 'running'" @click="runProject">
              <Loader2 v-if="runStatus === 'running'" class="animate-spin" :size="18" />
              <Play v-else :size="18" />
              <span>Запустить проект</span>
            </Button>
          </div>

          <div class="grid gap-2">
            <div class="flex items-center justify-between gap-2">
              <Tag
                :value="runStatus === 'running' ? 'running' : runStatus"
                :class="runStatus === 'error' ? 'inline-flex min-h-7 items-center rounded-full bg-rose/12 px-3 text-xs font-black text-rose' : tagBase.beginner"
              />
              <span class="text-xs font-bold text-muted">{{ lastRunAt }}</span>
            </div>
            <pre class="m-0 max-h-64 min-h-36 overflow-auto rounded-card border border-line bg-app px-3 py-3 font-mono text-xs leading-5 text-ink">{{ runOutput }}</pre>
          </div>

          <p v-if="compilerVersionsError" class="m-0 text-xs font-bold leading-5 text-amber">
            {{ compilerVersionsError }} Используется fallback {{ FALLBACK_KOTLIN_VERSION }}.
          </p>
          <p v-else-if="compilerVersionsLoading" class="m-0 text-xs font-bold text-muted">Загружаю версии Kotlin...</p>
        </section>

        <section :class="[layout.panel, 'grid gap-4 p-4']">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Diagnostics</p>
              <h2 class="m-0 mt-1 text-xl font-black">{{ compilerErrorCount }} errors</h2>
            </div>
            <CheckCircle2 v-if="diagnostics.length === 0 && runStatus === 'success'" class="text-accent" :size="22" />
            <AlertTriangle v-else class="text-amber" :size="22" />
          </div>

          <div v-if="diagnostics.length === 0" class="grid min-h-28 place-items-center rounded-card border border-line bg-app-soft p-4 text-center text-sm font-bold text-muted">
            Диагностика появится после запуска.
          </div>
          <div v-else class="grid max-h-72 gap-2 overflow-auto">
            <button
              v-for="(diagnostic, index) in diagnostics"
              :key="`${diagnostic.fileName}-${index}`"
              :class="['rounded-card border p-3 text-left transition hover:bg-panel-soft', diagnosticClass(diagnostic.severity)]"
              type="button"
              @click="revealDiagnostic(diagnostic)"
            >
              <span class="block text-xs font-black uppercase tracking-wide">{{ diagnostic.severity }}</span>
              <strong class="mt-1 block text-sm">{{ diagnostic.filePath }}{{ diagnostic.line ? `:${diagnostic.line}` : '' }}</strong>
              <span class="mt-2 block text-sm leading-5 text-ink/85">{{ diagnostic.message }}</span>
            </button>
          </div>
        </section>

        <section :class="[layout.panel, 'grid gap-4 p-4']">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Imports</p>
              <h2 class="m-0 mt-1 text-xl font-black">{{ exportedSymbols.length }} symbols</h2>
            </div>
            <Button :class="buttons.icon" title="Сбросить пример" aria-label="Сбросить пример" @click="resetProject">
              <RotateCcw :size="18" />
            </Button>
          </div>

          <div class="grid gap-2">
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Текущий файл</p>
            <div v-if="currentImports.length === 0" class="rounded-card border border-line bg-app-soft p-3 text-sm font-bold text-muted">
              Import-строк пока нет.
            </div>
            <div v-else class="grid gap-2">
              <div v-for="importItem in currentImports" :key="`${importItem.path}-${importItem.alias ?? ''}`" class="grid gap-2 rounded-card border border-line bg-app-soft p-3">
                <div class="flex items-center justify-between gap-2">
                  <code class="min-w-0 truncate font-mono text-xs text-ink">{{ importItem.path }}</code>
                  <Tag :value="importStatusLabel(importItem.status)" :class="importStatusClass(importItem.status)" />
                </div>
                <span v-if="importItem.targetFilePath" class="truncate text-xs font-bold text-muted">{{ importItem.targetFilePath }}</span>
              </div>
            </div>
          </div>

          <div class="grid gap-2">
            <p class="m-0 text-xs font-black uppercase tracking-wide text-muted">Можно импортировать</p>
            <div v-if="exportedSymbols.length === 0" class="rounded-card border border-line bg-app-soft p-3 text-sm font-bold text-muted">
              Добавьте `package` и объявления в соседних файлах.
            </div>
            <div v-else class="grid max-h-64 gap-2 overflow-auto">
              <div v-for="symbol in exportedSymbols" :key="`${symbol.fileId}-${symbol.importPath}`" class="grid gap-2 rounded-card border border-line bg-app-soft p-3">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <strong class="block truncate text-sm font-black text-ink">{{ symbol.name }}</strong>
                    <code class="block truncate font-mono text-xs text-muted">{{ symbol.importPath }}</code>
                  </div>
                  <Tag :value="symbol.kind" :class="tagBase.default" />
                </div>
                <div class="flex items-center gap-2">
                  <Button :class="[buttons.subtle, 'min-h-8 px-2 text-xs']" @click="insertImport(symbol.importPath)">
                    <ChevronRight :size="15" />
                    <span>Вставить</span>
                  </Button>
                  <Button :class="[buttons.icon, 'h-8 w-8']" :title="copiedImportPath === symbol.importPath ? 'Скопировано' : 'Скопировать import'" @click="copyImport(symbol.importPath)">
                    <Copy :size="15" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <p v-if="unresolvedImports.length > 0" class="m-0 text-xs font-bold leading-5 text-rose">
            {{ unresolvedImports.length }} import не найден в проекте или SDK.
          </p>
        </section>
      </main>
    </div>
  </div>
</template>
