<script setup lang="ts">
import { Smartphone } from '@lucide/vue'
import CourseReaderPage from '@/widgets/course-layout/ui/CourseReaderPage.vue'
import {
  composeCourseCategories,
  composeCourseDifficulties,
  composeCourseLessons,
  composeCourseModules,
  composeCourseStats,
} from '@/entities/course/model/course'
</script>

<template>
  <CourseReaderPage
    eyebrow="Android UI track"
    title="Jetpack Compose"
    :brand-icon="Smartphone"
    brand-icon-class="grid h-10 w-10 place-items-center rounded-card border border-violet/35 bg-violet/15 text-violet shadow-glow max-sm:h-8 max-sm:w-8"
    :lessons="composeCourseLessons"
    :modules="composeCourseModules"
    :categories="composeCourseCategories"
    :difficulties="composeCourseDifficulties"
    :stats="composeCourseStats"
    :switch-link="{ to: '/kotlin', label: 'Kotlin' }"
  />
</template>
