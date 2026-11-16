<script setup lang="ts">
// Asks before something that cannot be undone. What it is about goes in the
// default slot.
defineProps<{ title: string, action: string, color?: string }>()
const emit = defineEmits<{ confirm: [] }>()
const open = defineModel<boolean>({ default: false })

function confirm() {
  emit('confirm')
  open.value = false
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="480"
  >
    <v-card :title="title">
      <v-card-text>
        <slot />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="open = false">
          Cancel
        </v-btn>
        <v-btn
          :color="color ?? 'error'"
          variant="flat"
          @click="confirm"
        >
          {{ action }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
