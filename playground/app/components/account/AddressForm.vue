<script setup lang="ts">
import type { AddressFields } from '~/composables/useAccount'

// Adds an address, or edits one. Editing sends only the fields that changed,
// so two edits of different fields of one address stay two small changes.
const props = defineProps<{ address?: AddressFields & { id: string } | null }>()
const emit = defineEmits<{ save: [fields: Partial<AddressFields>] }>()
const open = defineModel<boolean>({ default: false })

const EMPTY: AddressFields = { name: '', line1: '', line2: '', city: '', region: '', postalCode: '', country: 'US' }
const fields = reactive<AddressFields>({ ...EMPTY })
watch(open, (isOpen) => {
  if (isOpen) Object.assign(fields, props.address ?? EMPTY)
})

const required = (v: string) => !!v?.trim() || 'Required'
const valid = computed(() => ['name', 'line1', 'city', 'region', 'postalCode', 'country'].every(k => fields[k as keyof AddressFields].trim()))

function save() {
  if (!valid.value) return
  const changed = props.address
    ? Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== props.address![k as keyof AddressFields]))
    : { ...fields }
  if (Object.keys(changed).length) emit('save', changed)
  open.value = false
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="560"
  >
    <v-card :title="address ? 'Edit address' : 'New address'">
      <v-card-text>
        <v-row dense>
          <v-col cols="12">
            <v-text-field
              v-model="fields.name"
              label="Name"
              :rules="[required]"
            />
          </v-col>
          <v-col cols="12">
            <v-text-field
              v-model="fields.line1"
              label="Street address"
              :rules="[required]"
            />
          </v-col>
          <v-col cols="12">
            <v-text-field
              v-model="fields.line2"
              label="Apartment, suite, unit (optional)"
            />
          </v-col>
          <v-col
            cols="12"
            sm="6"
          >
            <v-text-field
              v-model="fields.city"
              label="City"
              :rules="[required]"
            />
          </v-col>
          <v-col
            cols="6"
            sm="3"
          >
            <v-text-field
              v-model="fields.region"
              label="State"
              :rules="[required]"
            />
          </v-col>
          <v-col
            cols="6"
            sm="3"
          >
            <v-text-field
              v-model="fields.postalCode"
              label="ZIP"
              :rules="[required]"
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="open = false">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!valid"
          @click="save"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
