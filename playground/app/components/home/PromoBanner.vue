<script setup lang="ts">
import { mdiTagOutline } from '@mdi/js'

// A coupon worth knowing about. It is real: TOOLS20 works at checkout.
</script>

<template>
  <v-sheet
    rounded="xl"
    color="secondary"
    class="d-flex flex-wrap align-center ga-6 pa-8"
  >
    <v-avatar
      color="primary"
      size="56"
      rounded="lg"
    >
      <v-icon
        :icon="mdiTagOutline"
        size="30"
      />
    </v-avatar>
    <div class="flex-grow-1">
      <div class="text-headline-small font-weight-bold">
        20% off orders over $50
      </div>
      <div class="text-body-medium opacity-80">
        Use code <strong>TOOLS20</strong> in your cart. Works offline too: it is checked when your cart syncs.
      </div>
    </div>
    <v-btn
      to="/c/cat-2"
      color="primary"
      size="large"
    >
      Shop hand tools
    </v-btn>
  </v-sheet>
</template>
