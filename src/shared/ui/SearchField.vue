<script setup lang="ts">
import { Search } from '@lucide/vue'
import InputText from 'primevue/inputtext'

defineProps<{
  placeholder: string
}>()

const model = defineModel<string>({ required: true })
const searchClass =
  'grid min-h-11 grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-control border border-line bg-app-soft px-3 text-muted focus-within:border-accent/60 focus-within:shadow-glow'
const inputClass = 'min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-muted-soft'
</script>

<template>
  <label :class="searchClass">
    <Search :size="18" />
    <InputText v-model="model" :class="inputClass" :placeholder="placeholder" />
  </label>
</template>
