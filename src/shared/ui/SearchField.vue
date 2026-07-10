<script setup lang="ts">
import { Search } from '@lucide/vue'
import InputText from 'primevue/inputtext'
import { form } from '@/shared/config/ui'

defineProps<{
  placeholder: string
}>()

const model = defineModel<string>({ required: true })
</script>

<template>
  <label :class="form.search">
    <Search :size="18" />
    <InputText v-model="model" :class="form.input" :placeholder="placeholder" />
  </label>
</template>
