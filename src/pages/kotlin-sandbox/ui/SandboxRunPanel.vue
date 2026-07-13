<script setup lang="ts">
import { Loader2, Package, Play, Terminal } from '@lucide/vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import AppSelect from '@/shared/ui/AppSelect.vue'
import { buttons, form, layout, tagBase } from '@/shared/config/ui'
import { FALLBACK_KOTLIN_VERSION } from '@/pages/kotlin-sandbox/model/kotlinCompiler'

type RunStatus = 'idle' | 'running' | 'success' | 'error'

interface SelectOption {
  label: string
  value: string
}

defineProps<{
  compilerVersionOptions: SelectOption[]
  runStatus: RunStatus
  runOutput: string
  lastRunAt: string
  compilerVersionsError: string
  compilerVersionsLoading: boolean
}>()

const selectedCompilerVersion = defineModel<string>('selectedCompilerVersion', { required: true })
const programArgs = defineModel<string>('programArgs', { required: true })
const emit = defineEmits<{
  run: []
}>()
</script>

<template>
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
      <Button :class="[buttons.primary, 'w-full']" :disabled="runStatus === 'running'" @click="emit('run')">
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
</template>
