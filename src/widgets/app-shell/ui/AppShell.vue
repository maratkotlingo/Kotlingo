<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppFooter from './AppFooter.vue'
import AppNavbar from './AppNavbar.vue'
</script>

<template>
  <div class="min-h-screen bg-app text-ink">
    <AppNavbar />
    <RouterView />
    <AppFooter />
  </div>
</template>
