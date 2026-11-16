<script setup lang="ts">
import { mdiCloudOffOutline, mdiHeadset, mdiKeyboardReturn, mdiTruckFastOutline } from '@mdi/js'

// What every order comes with.
const props = [
  { icon: mdiTruckFastOutline, title: 'Free shipping', text: 'On every order over $100' },
  { icon: mdiCloudOffOutline, title: 'Works offline', text: 'Shop now, it syncs when you are back' },
  { icon: mdiKeyboardReturn, title: '30-day returns', text: 'Not right? Send it back' },
  { icon: mdiHeadset, title: 'Pro support', text: 'Ask people who use the tools' },
]
</script>

<template>
  <v-row>
    <v-col
      v-for="item in props"
      :key="item.title"
      cols="6"
      md="3"
    >
      <div class="d-flex align-center ga-3">
        <v-avatar
          color="primary"
          variant="tonal"
          rounded="lg"
          size="44"
        >
          <v-icon :icon="item.icon" />
        </v-avatar>
        <div>
          <div class="text-title-small">
            {{ item.title }}
          </div>
          <div class="text-body-small text-medium-emphasis">
            {{ item.text }}
          </div>
        </div>
      </div>
    </v-col>
  </v-row>
</template>
