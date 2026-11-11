export const getCartStorageKey = (userId) =>
  `shopco-cart:${userId === null ? 'guest' : `user:${encodeURIComponent(String(userId))}`}`
