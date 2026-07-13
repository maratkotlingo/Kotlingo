import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/pages/home/ui/HomePage.vue'
import ComposeCoursePage from '@/pages/compose-course/ui/ComposeCoursePage.vue'
import KotlinCoursePage from '@/pages/kotlin-course/ui/KotlinCoursePage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/kotlin', name: 'kotlin', component: KotlinCoursePage },
    { path: '/compose', name: 'compose', component: ComposeCoursePage },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    }

    if (to.hash && !to.hash.startsWith('#lesson/')) {
      return { el: to.hash, behavior: 'smooth' }
    }

    return { top: 0 }
  },
})
