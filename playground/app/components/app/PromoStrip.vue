<script setup lang="ts">
import { mdiCloudOffOutline, mdiTruckFastOutline } from '@mdi/js'

// The strip above the app bar: what every shopper should know.
</script>

<template>
  <v-system-bar
    color="secondary"
    height="32"
    class="justify-center ga-6 text-label-medium"
  >
    <span class="d-flex align-center ga-2">
      <v-icon
        :icon="mdiTruckFastOutline"
        size="small"
      />
      Free shipping on orders over $100
    </span>
    <span class="d-none d-sm-flex align-center ga-2">
      <v-icon
        :icon="mdiCloudOffOutline"
        size="small"
      />
      Shop offline: your changes sync when you are back
    </span>
  </v-system-bar>
</template>
