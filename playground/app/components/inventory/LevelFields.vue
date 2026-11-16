<script setup lang="ts">
// An item's current count and, at a site that tracks inventory, the levels it
// is kept between. Shared by adding an item and editing one.
defineProps<{ tracking: boolean, hideOnHand?: boolean }>()
const onHand = defineModel<number>('onHand', { default: 0 })
const min = defineModel<number>('min', { default: 0 })
const max = defineModel<number>('max', { default: 0 })
</script>

<template>
  <v-row dense>
    <v-col
      v-if="!hideOnHand"
      cols="12"
      :sm="tracking ? 4 : 12"
    >
      <v-number-input
        v-model="onHand"
        label="Current inventory"
        :min="0"
        control-variant="stacked"
        hint="What the site holds now"
        persistent-hint
      />
    </v-col>
    <template v-if="tracking">
      <v-col
        cols="6"
        :sm="hideOnHand ? 6 : 4"
      >
        <v-number-input
          v-model="min"
          label="Min"
          :min="0"
          control-variant="stacked"
          hint="Restock below this"
          persistent-hint
        />
      </v-col>
      <v-col
        cols="6"
        :sm="hideOnHand ? 6 : 4"
      >
        <v-number-input
          v-model="max"
          label="Max"
          :min="0"
          control-variant="stacked"
          :error-messages="min > max ? 'Max must be at least min' : undefined"
          hint="Restock up to this"
          persistent-hint
        />
      </v-col>
    </template>
  </v-row>
</template>
