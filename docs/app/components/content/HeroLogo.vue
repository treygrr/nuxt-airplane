<script setup lang="ts">
import { withBase } from 'ufo'

// Used from content/index.md as `:hero-logo`; resolves the asset under app.baseURL.
const { app } = useRuntimeConfig()
const logo = withBase('/logo.png', app.baseURL)
const logo2x = withBase('/logo@2x.png', app.baseURL)
</script>

<template>
  <img
    :src="logo"
    :srcset="`${logo} 1x, ${logo2x} 2x`"
    alt="nuxt-airplane logo"
    width="96"
    height="96"
    class="mx-auto mb-6 size-24 drop-shadow-xl lg:mx-0"
  >
</template>
