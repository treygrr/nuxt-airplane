// Changes the chaos settings given, leaving the others: `{ "loseNext": 1 }`.
import { setChaos, type Chaos } from '../../utils/lab'

export default defineEventHandler(async event => setChaos((await readBody<Partial<Chaos>>(event)) ?? {}))
