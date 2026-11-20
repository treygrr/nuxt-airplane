// The define* helpers, `isTempId` and `hasFields`, as globals in the worker. In the app they are
// auto-imported; a worker bundle that was built without that transform still
// finds them here. Imported first by the worker entry.

import { defineAirplaneRequest } from './composables/defineAirplaneRequest'
import { defineAirplaneStores } from './composables/defineAirplaneStores'
import { defineMutationHandler } from './composables/defineMutationHandler'
import { defineMutationHandlers } from './composables/defineMutationHandlers'
import { defineQueryHandler } from './composables/defineQueryHandler'
import { defineQueryHandlers } from './composables/defineQueryHandlers'
import { hasFields } from './hasFields'
import { isTempId } from './tempIds'

Object.assign(globalThis, { defineAirplaneRequest, defineAirplaneStores, defineMutationHandler, defineMutationHandlers, defineQueryHandler, defineQueryHandlers, hasFields, isTempId })
