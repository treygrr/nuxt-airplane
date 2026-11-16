import { catalogChanged, fail, mutation, nextId, store, type RequestContext } from '../../utils/lab'
import { findProduct } from '../../utils/shop'
import type { Review } from '../../utils/seed'

function findMine(id: string) {
  const review = store().reviews.find(r => r.id === id) ?? fail('NOT_FOUND', `No review ${id}`)
  return review.mine ? review : fail('FORBIDDEN', 'You can only change your own reviews')
}

function check({ rating, title }: { rating?: number | null, title?: string | null }) {
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) fail('BAD_USER_INPUT', 'A rating is 1 to 5 stars')
  if (title != null && !title.trim()) fail('BAD_USER_INPUT', 'A review needs a title')
}

const newestFirst = (a: Review, b: Review) => b.createdAt.localeCompare(a.createdAt)

export const reviews = {
  Query: {
    reviews: (_: unknown, { productId }: { productId: string }) => store().reviews.filter(r => r.productId === productId).sort(newestFirst).map(r => ({ ...r })),
    myReviews: () => store().reviews.filter(r => r.mine).sort(newestFirst).map(r => ({ ...r })),
  },
  Mutation: {
    createReview: (_: unknown, args: { productId: string, rating: number, title: string, body: string }, ctx: RequestContext) =>
      mutation(ctx, 'createReview', `ProductReviews:${args.productId}`, () => {
        if (!findProduct(args.productId)) fail('NOT_FOUND', `No product ${args.productId}`)
        check(args)
        const review: Review = { id: nextId('review'), productId: args.productId, authorName: store().customer.name, rating: args.rating, title: args.title.trim(), body: args.body, createdAt: new Date().toISOString(), mine: true }
        store().reviews.push(review)
        catalogChanged()
        return { ...review }
      }),

    updateReview: (_: unknown, { id, ...patch }: { id: string, rating?: number | null, title?: string | null, body?: string | null }, ctx: RequestContext) =>
      mutation(ctx, 'updateReview', `Review:${id}`, () => {
        const review = findMine(id)
        check(patch)
        if (patch.rating != null) review.rating = patch.rating
        if (patch.title != null) review.title = patch.title.trim()
        if (patch.body != null) review.body = patch.body
        catalogChanged()
        return { ...review }
      }),

    deleteReview: (_: unknown, { id }: { id: string }, ctx: RequestContext) =>
      mutation(ctx, 'deleteReview', `Review:${id}`, () => {
        findMine(id)
        store().reviews = store().reviews.filter(r => r.id !== id)
        catalogChanged()
        return id
      }),
  },
}
