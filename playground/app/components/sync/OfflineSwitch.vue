<script setup lang="ts">
// "Work offline": hold the client offline whatever the network says.
const sync = useSync()

const offline = computed({
  get: () => sync.forcedOffline.value,
  set: value => (value ? sync.goOffline() : sync.goOnline()),
})
</script>

<template>
  <v-switch
    v-model="offline"
    label="Work offline"
    color="warning"
    density="compact"
    hide-details
    inset
  />
</template>
