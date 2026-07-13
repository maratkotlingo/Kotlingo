<script setup lang="ts">
import { AlertTriangle, CheckCircle2 } from '@lucide/vue'
import { layout } from '@/shared/config/ui'
import type { RuntimeDiagnostic } from '@/pages/kotlin-sandbox/model/kotlinCompiler'

type RunStatus = 'idle' | 'running' | 'success' | 'error'

defineProps<{
  diagnostics: RuntimeDiagnostic[]
  compilerErrorCount: number
  runStatus: RunStatus
}>()

const emit = defineEmits<{
  reveal: [diagnostic: RuntimeDiagnostic]
}>()

function diagnosticClass(severity: string): string {
  return severity === 'ERROR'
    ? 'border-rose/35 bg-rose/10 text-rose'
    : 'border-amber/35 bg-amber/10 text-amber'
}
</script>

<template>
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
        @click="emit('reveal', diagnostic)"
      >
        <span class="block text-xs font-black uppercase tracking-wide">{{ diagnostic.severity }}</span>
        <strong class="mt-1 block text-sm">{{ diagnostic.filePath }}{{ diagnostic.line ? `:${diagnostic.line}` : '' }}</strong>
        <span class="mt-2 block text-sm leading-5 text-ink/85">{{ diagnostic.message }}</span>
      </button>
    </div>
  </section>
</template>
