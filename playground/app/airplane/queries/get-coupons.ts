import { replaceAll } from '../../lib/airplane'

export default defineQueryHandler('GetCoupons', {
  store: ({ db }, data) => replaceAll(db.Coupon, data.coupons),
  read: async ({ db }) => ({ coupons: await db.Coupon.toArray() }),
})
