<script setup lang="ts">
import { mdiArrowRight, mdiFlashlight, mdiHammer, mdiPowerPlug, mdiTapeMeasure } from '@mdi/js'

// The front page's opening: what the shop is, and where to start.
const tools = [
  { icon: mdiPowerPlug, top: '8%', left: '58%', size: 120, turn: -12 },
  { icon: mdiHammer, top: '46%', left: '74%', size: 96, turn: 18 },
  { icon: mdiTapeMeasure, top: '58%', left: '52%', size: 72, turn: -6 },
  { icon: mdiFlashlight, top: '14%', left: '82%', size: 64, turn: 24 },
]
</script>

<template>
  <v-sheet
    rounded="xl"
    class="hero position-relative overflow-hidden pa-8 pa-md-12"
  >
    <div
      class="position-relative"
      style="max-width: 560px; z-index: 1"
    >
      <div class="text-label-large text-uppercase mb-3 opacity-80">
        New season, new kit
      </div>
      <h1
        class="text-display-small font-weight-bold mb-4"
        style="line-height: 1.1"
      >
        Tools that work as hard as you do
      </h1>
      <p class="text-body-large mb-8 opacity-90">
        Thousands of tools from the brands the trades trust. Build your cart on the job site, with or without signal.
      </p>
      <div class="d-flex flex-wrap ga-3">
        <v-btn
          to="/c/cat-1"
          color="white"
          size="large"
          :append-icon="mdiArrowRight"
          class="text-primary"
        >
          Shop power tools
        </v-btn>
        <v-btn
          to="/search"
          variant="outlined"
          size="large"
          color="white"
        >
          Browse everything
        </v-btn>
      </div>
    </div>
    <v-icon
      v-for="(tool, i) in tools"
      :key="i"
      :icon="tool.icon"
      :size="tool.size"
      class="hero-tool d-none d-md-flex"
      :style="{ top: tool.top, left: tool.left, transform: `rotate(${tool.turn}deg)` }"
    />
  </v-sheet>
</template>

<style scoped>
.hero {
  background: linear-gradient(120deg, rgb(var(--v-theme-primary)) 0%, #b23a10 55%, #7c2d12 100%);
  color: #fff;
}
.hero-tool {
  position: absolute;
  color: rgba(255, 255, 255, 0.18);
}
</style>
