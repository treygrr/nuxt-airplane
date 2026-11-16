import base from './playwright.config'

export default { ...base, use: { ...base.use, baseURL: 'http://localhost:3140' }, webServer: { ...base.webServer, command: 'cd .. && npx nuxt build playground && PORT=3140 node playground/.output/server/index.mjs', url: 'http://localhost:3140', reuseExistingServer: false } }
