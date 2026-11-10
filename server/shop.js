export function resolveCartItems(cart, products) {
  if (!Array.isArray(cart) || cart.length === 0 || cart.length > 50) {
    throw new Error('O carrinho deve conter entre 1 e 50 produtos')
  }

  const seen = new Set()
  return cart.map((entry) => {
    if (!entry || typeof entry.id !== 'string' || seen.has(entry.id)) {
      throw new Error('O carrinho contém um produto inválido ou duplicado')
    }
    seen.add(entry.id)

    if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 99) {
      throw new Error('A quantidade do produto é inválida')
    }

    const product = products.find((item) => item.id === entry.id)
    if (!product) {
      throw new Error(`Produto ${entry.id} não encontrado`)
    }

    if (!Number.isInteger(product.stock) || product.stock < entry.quantity) {
      throw new Error(`Stock insuficiente para ${product.name}`)
    }

    const unitAmount = Math.round(Number(product.price) * 100)
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
      throw new Error(`Preço inválido para ${product.name}`)
    }

    return { product, quantity: entry.quantity, unitAmount }
  })
}

export function reserveInventory(products, items) {
  const reservations = items.map(({ product, quantity }) => {
    const currentProduct = products.find((entry) => entry.id === product.id)
    if (!currentProduct || currentProduct.stock < quantity) {
      throw new Error(`Stock insuficiente para ${product.name}`)
    }
    return { product: currentProduct, quantity }
  })

  for (const { product, quantity } of reservations) {
    product.stock -= quantity
  }
}

export function releaseInventory(products, items) {
  for (const item of items) {
    const product = products.find((entry) => entry.id === item.productId)
    if (product) product.stock += item.quantity
  }
}
