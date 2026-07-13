<script setup lang="ts">
import { ref } from 'vue'
import Select from 'primevue/select'
import { useExternalSelectDismiss, type SelectOverlayControl } from '@/shared/lib/useExternalSelectDismiss'

export interface SelectOption {
  label: string
  value: string
}

withDefaults(
  defineProps<{
    options: SelectOption[]
    dataTestid?: string
    appendTo?: string
  }>(),
  {
    appendTo: 'body',
    dataTestid: undefined,
  },
)

const model = defineModel<string>({ required: true })
const select = ref<SelectOverlayControl | null>(null)
const { setOpenSelect, clearOpenSelect } = useExternalSelectDismiss()

const selectPt = {
  root: {
    class:
      'relative flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-between rounded-control border border-line bg-app-soft px-3 text-sm text-ink transition hover:border-line-strong data-[p-focused=true]:border-accent/60 data-[p-focused=true]:shadow-glow',
  },
  label: {
    class: 'min-w-0 truncate pr-3 text-ink',
  },
  dropdown: {
    class: 'ml-auto inline-flex h-6 w-6 items-center justify-center text-muted',
  },
  overlay: {
    class:
      'z-[90] mt-2 overflow-hidden rounded-card border border-line bg-panel-raised text-ink shadow-panel ring-1 ring-white/5',
    'data-kotlingo-select-surface': 'true',
  },
  listContainer: {
    class: 'max-h-72 overflow-auto overscroll-contain p-1',
    'data-kotlingo-select-surface': 'true',
  },
  list: {
    class: 'm-0 list-none p-0',
    'data-kotlingo-select-surface': 'true',
  },
  option: {
    class:
      'cursor-pointer rounded-md px-3 py-2 text-sm text-ink transition hover:bg-accent/10 data-[p-selected=true]:bg-accent/15 data-[p-selected=true]:text-accent',
    'data-kotlingo-select-surface': 'true',
  },
  optionLabel: {
    class: 'truncate',
  },
  emptyMessage: {
    class: 'px-3 py-2 text-sm text-muted',
  },
}
</script>

<template>
  <Select
    ref="select"
    v-model="model"
    :append-to="appendTo"
    :data-testid="dataTestid"
    :options="options"
    :pt="selectPt"
    option-label="label"
    option-value="value"
    @show="setOpenSelect(select)"
    @hide="clearOpenSelect(select)"
  />
</template>
