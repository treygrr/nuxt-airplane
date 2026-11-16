<script setup lang="ts">
import { mdiCloudUploadOutline } from '@mdi/js'

// Marks something changed here that has not reached the server yet.
</script>

<template>
  <v-chip
    :prepend-icon="mdiCloudUploadOutline"
    size="x-small"
    color="info"
    variant="tonal"
  >
    Not synced
  </v-chip>
</template>
