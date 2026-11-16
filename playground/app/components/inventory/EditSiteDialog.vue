<script setup lang="ts">
// Edits a site: its name, and whether it tracks inventory. Only what changed
// is sent.
const props = defineProps<{ site: { id: string, name: string, tracksInventory: boolean } | null }>()
const emit = defineEmits<{ close: [] }>()

const name = ref('')
const tracking = ref(false)
watch(() => props.site, (site) => {
  if (!site) return
  name.value = site.name
  tracking.value = site.tracksInventory
}, { immediate: true })

const { renameSite, setTracking } = useInventory()
function save() {
  const site = props.site
  if (!site || !name.value.trim()) return
  if (name.value.trim() !== site.name) renameSite.mutate({ id: site.id, name: name.value.trim() })
  if (tracking.value !== site.tracksInventory) setTracking.mutate({ id: site.id, enabled: tracking.value })
  emit('close')
}
</script>

<template>
  <v-dialog
    :model-value="!!site"
    max-width="460"
    @update:model-value="!$event && emit('close')"
  >
    <v-card
      v-if="site"
      title="Edit site"
    >
      <v-card-text>
        <v-text-field
          v-model="name"
          label="Name"
          autofocus
          @keydown.enter="save"
        />
        <v-switch
          v-model="tracking"
          label="Track inventory levels"
          color="primary"
          hint="Keeps a min and max for each item"
          persistent-hint
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('close')">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!name.trim()"
          @click="save"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
