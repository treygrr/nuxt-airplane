<script setup lang="ts">
// The pending-changes panel, sliding in from the right.
const open = useQueueDrawer()
</script>

<template>
  <v-navigation-drawer
    v-model="open"
    location="end"
    width="440"
    temporary
  >
    <QueuePanel />
  </v-navigation-drawer>
</template>
