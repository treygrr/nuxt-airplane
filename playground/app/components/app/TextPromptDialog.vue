<script setup lang="ts">
// Asks for one line of text: a new name, a note.
const props = defineProps<{ title: string, label: string, value?: string, action?: string }>()
const emit = defineEmits<{ submit: [value: string] }>()
const open = defineModel<boolean>({ default: false })

const text = ref('')
watch(open, (isOpen) => {
  if (isOpen) text.value = props.value ?? ''
})

function submit() {
  const value = text.value.trim()
  if (!value) return
  emit('submit', value)
  open.value = false
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="420"
  >
    <v-card :title="title">
      <v-card-text>
        <v-text-field
          v-model="text"
          :label="label"
          autofocus
          hide-details
          @keydown.enter="submit"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="open = false">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!text.trim()"
          @click="submit"
        >
          {{ action ?? 'Save' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
