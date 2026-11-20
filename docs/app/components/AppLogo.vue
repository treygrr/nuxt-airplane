<script setup lang="ts">
import { withBase } from 'ufo'

// Public assets are served under app.baseURL (/nuxt-airplane/ on GitHub Pages).
const { app } = useRuntimeConfig()
// Two drawings: white on black for the dark theme, black on white for the light one.
const logo = withBase('/logo.svg', app.baseURL)
const logoLight = withBase('/logo-light.svg', app.baseURL)
</script>

<template>
  <span class="flex items-center gap-2.5 font-semibold text-highlighted">
    <img
      :src="logoLight"
      alt=""
      width="44"
      height="44"
      class="size-11 shrink-0 dark:hidden"
    >
    <img
      :src="logo"
      alt=""
      width="44"
      height="44"
      class="hidden size-11 shrink-0 dark:block"
    >
    nuxt-airplane
  </span>
</template>
