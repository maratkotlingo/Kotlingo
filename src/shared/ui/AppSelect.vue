<script setup lang="ts">
import { ref } from 'vue'
import Select from 'primevue/select'
import { selectPt } from '@/shared/config/ui'
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
