<script setup lang="ts">
import { withBase } from 'ufo'

// Public assets are served under app.baseURL (/nuxt-airplane/ on GitHub Pages).
const { app } = useRuntimeConfig()
const logo = withBase('/logo.png', app.baseURL)
const logo2x = withBase('/logo@2x.png', app.baseURL)
</script>

<template>
  <span class="flex items-center gap-2 font-semibold text-highlighted">
    <img
      :src="logo"
      :srcset="`${logo} 1x, ${logo2x} 2x`"
      alt=""
      width="28"
      height="28"
      class="size-7 shrink-0"
    >
    nuxt-airplane
  </span>
</template>
