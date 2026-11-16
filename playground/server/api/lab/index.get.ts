// What the lab page and the end-to-end tests read: the chaos settings and the counters.
import { chaos, labStats } from '../../utils/lab'

export default defineEventHandler(() => ({ chaos, stats: labStats() }))
