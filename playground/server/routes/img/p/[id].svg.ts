// A product picture: the product's initials on a color picked from its id.
// The shop has no photos, and this keeps it from looking like it is missing them.
import { findProduct } from '../../../utils/shop'

const COLORS = ['#c2410c', '#0f766e', '#1d4ed8', '#7c3aed', '#be123c', '#4d7c0f', '#a16207', '#334155']

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')?.replace(/\.svg$/, '') ?? ''
  const product = findProduct(id)
  const words = (product?.name ?? '?').split(' ').filter(w => /^[A-Z]/.test(w))
  const initials = (words.slice(1, 3).map(w => w[0]).join('') || '?').toUpperCase()
  const color = COLORS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length]
  setResponseHeader(event, 'content-type', 'image/svg+xml')
  setResponseHeader(event, 'cache-control', 'public, max-age=86400')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="${color}"/><text x="200" y="175" font-family="system-ui, sans-serif" font-size="96" font-weight="700" fill="#fff" fill-opacity="0.9" text-anchor="middle">${initials}</text></svg>`
})
