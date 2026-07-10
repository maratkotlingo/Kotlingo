<script setup lang="ts">
import type { Component } from 'vue'
import { layout } from '@/shared/config/ui'

defineProps<{
  icon: Component
  label: string
  value: string | number
  iconClass?: string
}>()
</script>

<template>
  <div :class="[layout.panel, 'grid min-h-20 grid-cols-[30px_minmax(0,1fr)] items-center gap-x-3 p-4']">
    <component :is="icon" :class="['row-span-2', iconClass ?? 'text-accent']" :size="22" />
    <span class="text-xs font-black uppercase tracking-wide text-muted">{{ label }}</span>
    <strong class="text-2xl font-black leading-none">{{ value }}</strong>
  </div>
</template>
