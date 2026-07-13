<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon: Component
  label: string
  value: string | number
  iconClass?: string
}>()

const panelClass = 'rounded-card border border-line bg-panel/95 shadow-panel backdrop-blur-xl'
</script>

<template>
  <div :class="[panelClass, 'grid min-h-20 grid-cols-[30px_minmax(0,1fr)] items-center gap-x-3 p-4']">
    <component :is="icon" :class="['row-span-2', iconClass ?? 'text-accent']" :size="22" />
    <span class="text-xs font-black uppercase tracking-wide text-muted">{{ label }}</span>
    <strong class="text-2xl font-black leading-none">{{ value }}</strong>
  </div>
</template>
