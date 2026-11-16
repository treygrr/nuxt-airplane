// A product picture: its category's tool on a pale ground, with the brand
// beneath. The shop has no photos; this keeps it from looking like it is
// missing them. The route is /img/product/<id>.svg: the parameter is the file name.
import { categoryStyle } from '#shared/categoryStyle'
import { store } from '../../../utils/lab'
import { findProduct } from '../../../utils/shop'

const escape = (text: string) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'file')?.replace(/\.svg$/, '') ?? ''
  const product = findProduct(id)
  const { categories } = store()
  const category = categories.find(c => c.id === product?.categoryId)
  const parent = categories.find(c => c.id === category?.parentId)
  const { icon, color, tint } = categoryStyle(category?.name ?? '', parent?.name)
  // A little variety between products of one category: the angle of the tool.
  const tilt = ([...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 5 - 2) * 6

  setResponseHeader(event, 'content-type', 'image/svg+xml')
  setResponseHeader(event, 'cache-control', 'public, max-age=3600')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tint}"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#g)"/>
  <circle cx="200" cy="135" r="92" fill="${color}" fill-opacity="0.08"/>
  <g transform="translate(200 135) rotate(${tilt}) translate(-66 -66) scale(5.5)"><path d="${icon}" fill="${color}"/></g>
  <text x="200" y="268" font-family="system-ui, sans-serif" font-size="17" font-weight="700" letter-spacing="3" fill="${color}" fill-opacity="0.75" text-anchor="middle">${escape((product?.brand ?? '').toUpperCase())}</text>
</svg>`
})
