<script setup lang="ts">
import { mdiCartOutline, mdiMenu } from '@mdi/js'

defineEmits<{ toggleNav: [] }>()
</script>

<template>
  <v-app-bar
    flat
    border="b"
  >
    <template #prepend>
      <v-app-bar-nav-icon
        :icon="mdiMenu"
        aria-label="Menu"
        @click="$emit('toggleNav')"
      />
    </template>

    <v-app-bar-title>
      <NuxtLink
        to="/"
        class="text-decoration-none text-high-emphasis font-weight-bold"
      >
        Toolshed
      </NuxtLink>
    </v-app-bar-title>

    <template #append>
      <SyncIndicator class="me-2" />
      <v-btn
        :icon="mdiCartOutline"
        to="/cart"
        aria-label="Cart"
      />
    </template>
  </v-app-bar>
</template>
