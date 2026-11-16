<script setup lang="ts">
import { mdiHammerWrench } from '@mdi/js'
</script>

<template>
  <NuxtLink
    to="/"
    class="d-flex align-center ga-2 text-decoration-none text-high-emphasis"
    aria-label="Toolshed home"
  >
    <v-avatar
      color="primary"
      rounded="lg"
      size="36"
    >
      <v-icon
        :icon="mdiHammerWrench"
        size="22"
      />
    </v-avatar>
    <span
      class="text-title-large font-weight-bold"
      style="font-family: var(--v-font-heading); letter-spacing: -0.02em"
    >Toolshed</span>
  </NuxtLink>
</template>
