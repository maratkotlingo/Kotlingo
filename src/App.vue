<script setup lang="ts">
import AppShell from '@/widgets/app-shell/ui/AppShell.vue'
</script>

<template>
  <AppShell />
</template>

<style>
html {
  scroll-behavior: smooth;
}

* {
  scrollbar-color: color-mix(in srgb, var(--color-line-strong) 78%, var(--color-accent) 22%) var(--color-app-soft);
  scrollbar-width: thin;
}

*::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}

*::-webkit-scrollbar-track {
  background: var(--color-app-soft);
}

*::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--color-line-strong) 78%, var(--color-accent) 22%);
  border: 3px solid var(--color-app-soft);
  border-radius: 999px;
}

*::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--color-line-strong) 56%, var(--color-accent) 44%);
}

*::-webkit-scrollbar-thumb:active {
  background: var(--color-accent-strong);
}

*::-webkit-scrollbar-corner {
  background: var(--color-app);
}

body {
  min-width: 20rem;
  margin: 0;
  overflow-x: hidden;
  background: var(--color-app);
  color: var(--color-ink);
  font-family: var(--font-sans);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

button,
input {
  font: inherit;
}

button {
  cursor: pointer;
}

svg {
  flex-shrink: 0;
}
</style>
