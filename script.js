const btnOpen = document.getElementById('openMenu')
const btnClose = document.getElementById('closeMenu')
const menu = document.getElementById('menu')
const letras = document.getElementById('letters')
const btnRemove = document.getElementById('remove')
const promocao = document.getElementById('set-off')
const btnPrev = document.getElementById('btnRecuar')
const btnNext = document.getElementById('btnAvancar')
const scrollContent = document.getElementById('comentariosGeral')
const imagem = document.getElementById('ucp')
const productSearch = document.getElementById('inletsearch')
const productsGrid = document.getElementById('productsGrid')
const openCartButton = document.getElementById('openCart')
const closeCartButton = document.getElementById('closeCart')
const cartPanel = document.getElementById('cartPanel')
const cartOverlay = document.getElementById('cartOverlay')
const cartItemsContainer = document.getElementById('cartItems')
const cartTotalElement = document.getElementById('cartTotal')
const cartCountElement = document.getElementById('cartCount')
const checkoutButton = document.getElementById('checkoutBtn')

const products = [
  {
    id: 'tshirt-virgem',
    name: 'T-shirt Preta Virgem',
    category: 'camisetas',
    price: 120,
    oldPrice: 150,
    rating: 4,
    image: 'image/roupas/t_shert.png',
    description: 'T-shirt casual com corte moderno e material leve.'
  },
  {
    id: 'calca-jeans',
    name: 'Calça Jeans',
    category: 'calcas',
    price: 240,
    oldPrice: 260,
    rating: 3,
    image: 'image/roupas/calça.png',
    description: 'Calça jeans clássica, confortável e versátil.'
  },
  {
    id: 'camisa-quadriculada',
    name: 'Camisa Quadriculada',
    category: 'camisetas',
    price: 180,
    oldPrice: 0,
    rating: 5,
    image: 'image/roupas/camisa.png',
    description: 'Estilo casual e elegante para o dia a dia.'
  },
  {
    id: 'tshirt-listrada',
    name: 'T-shirt Listrada',
    category: 'camisetas',
    price: 130,
    oldPrice: 160,
    rating: 4,
    image: 'image/roupas/camisola.png',
    description: 'Peça leve com design moderno em listras.'
  },
  {
    id: 'camisa-mais-vendida',
    name: 'Camisa Premium',
    category: 'camisetas',
    price: 212,
    oldPrice: 232,
    rating: 4,
    image: 'image/roupas/mais_vendidos/camisa_mais_vendida.png',
    description: 'Muito procurada por quem gosta de estilo casual.'
  },
  {
    id: 'tshirt-venda',
    name: 'T-shirt Clássica',
    category: 'camisetas',
    price: 120,
    oldPrice: 0,
    rating: 4,
    image: 'image/roupas/mais_vendidos/t_sher_mais_vendida.png',
    description: 'Perfeita para combinar com várias peças e ocasiões.'
  },
  {
    id: 'casaco-acessorio',
    name: 'Acessório Essentials',
    category: 'acessorios',
    price: 90,
    oldPrice: 110,
    rating: 5,
    image: 'image/hat.png',
    description: 'Complemento essencial para o teu look.'
  },
  {
    id: 'sapatilha-casual',
    name: 'Sapatilha Casual',
    category: 'acessorios',
    price: 210,
    oldPrice: 240,
    rating: 4,
    image: 'image/white-shoe.png',
    description: 'Conforto e estilo em uma sola moderna.'
  }
]

const CART_KEY = 'shopco-cart'
let cart = []

const readCartFromStorage = () => {
  try {
    const storedCart = JSON.parse(localStorage.getItem(CART_KEY) || '[]')
    return Array.isArray(storedCart) ? storedCart : []
  } catch (error) {
    return []
  }
}

const writeCartToStorage = () => {
  localStorage.setItem(CART_KEY, JSON.stringify(cart))
}

const getProductById = (productId) => products.find((product) => product.id === productId)

const formatPrice = (value) => `$${value}`

const updateCartBadge = () => {
  if (!cartCountElement) return
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0)
  cartCountElement.textContent = totalItems
}

const renderProducts = () => {
  if (!productsGrid) return

  const filter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all'
  const searchTerm = productSearch ? productSearch.value.trim().toLowerCase() : ''

  const filteredProducts = products.filter((product) => {
    const matchesFilter = filter === 'all' || product.category === filter
    const matchesSearch = !searchTerm || product.name.toLowerCase().includes(searchTerm) || product.description.toLowerCase().includes(searchTerm)
    return matchesFilter && matchesSearch
  })

  if (!filteredProducts.length) {
    productsGrid.innerHTML = '<div class="empty-products">Nenhum produto encontrado.</div>'
    return
  }

  productsGrid.innerHTML = filteredProducts.map((product) => {
    const discount = product.oldPrice ? Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100) : 0

    return `
      <article class="product-card">
        <div class="product-image-wrap">
          <img src="${product.image}" alt="${product.name}" class="product-image">
        </div>
        <div class="product-info">
          <h3>${product.name}</h3>
          <p class="product-rating"><img src="image/icons/Frame 10.png" alt=""> ${product.rating}/5</p>
          <div class="product-pricing">
            <span class="current-price">${formatPrice(product.price)}</span>
            ${product.oldPrice ? `<span class="old-price">${formatPrice(product.oldPrice)}</span>` : ''}
            ${discount ? `<span class="discount-badge">-${discount}%</span>` : ''}
          </div>
          <p class="product-description">${product.description}</p>
          <button type="button" class="add-cart-btn" data-product-id="${product.id}">Adicionar ao carrinho</button>
        </div>
      </article>
    `
  }).join('')
}

const renderCart = () => {
  if (!cartItemsContainer || !cartTotalElement) return

  const totalValue = cart.reduce((sum, item) => {
    const product = getProductById(item.id)
    return product ? sum + product.price * item.quantity : sum
  }, 0)

  cartTotalElement.textContent = formatPrice(totalValue)
  updateCartBadge()

  if (!cart.length) {
    cartItemsContainer.innerHTML = '<p class="empty-cart">O teu carrinho está vazio.</p>'
    return
  }

  cartItemsContainer.innerHTML = cart.map((item) => {
    const product = getProductById(item.id)
    if (!product) return ''

    return `
      <div class="cart-item">
        <img src="${product.image}" alt="${product.name}" class="cart-item-image">
        <div class="cart-item-details">
          <p class="cart-item-name">${product.name}</p>
          <p class="cart-item-price">${formatPrice(product.price)}</p>
          <div class="quantity-controls">
            <button type="button" data-action="qty" data-product-id="${product.id}" data-delta="-1" aria-label="Diminuir quantidade">-</button>
            <span>${item.quantity}</span>
            <button type="button" data-action="qty" data-product-id="${product.id}" data-delta="1" aria-label="Aumentar quantidade">+</button>
          </div>
        </div>
        <button type="button" class="remove-item" data-action="remove" data-product-id="${product.id}">Remover</button>
      </div>
    `
  }).join('')
}

const addProductToCart = (productId) => {
  const existingItem = cart.find((item) => item.id === productId)
  if (existingItem) {
    existingItem.quantity += 1
  } else {
    cart.push({ id: productId, quantity: 1 })
  }

  writeCartToStorage()
  renderCart()
  toggleCart(true)
}

const changeItemQuantity = (productId, delta) => {
  const item = cart.find((entry) => entry.id === productId)
  if (!item) return

  item.quantity += delta

  if (item.quantity <= 0) {
    cart = cart.filter((entry) => entry.id !== productId)
  }

  writeCartToStorage()
  renderCart()
}

const toggleCart = (isOpen) => {
  if (!cartPanel || !cartOverlay) return
  cartPanel.classList.toggle('is-open', isOpen)
  cartOverlay.classList.toggle('is-visible', isOpen)
}

btnOpen?.addEventListener('click', function () {
  menu?.classList.add('is-open')
  letras?.style.setProperty('display', 'none')
  btnClose?.style.setProperty('display', 'block')
  imagem?.style.setProperty('display', 'none')
})

btnClose?.addEventListener('click', function () {
  menu?.classList.remove('is-open')
  btnClose.style.display = 'none'
  letras?.removeAttribute('style')
  imagem?.style.setProperty('display', 'flex')
})

btnRemove?.addEventListener('click', function () {
  promocao?.style.setProperty('display', 'none')
})

btnNext?.addEventListener('click', function () {
  if (!scrollContent) return
  scrollContent.scrollBy({ left: scrollContent.clientWidth, behavior: 'smooth' })
})

btnPrev?.addEventListener('click', function () {
  if (!scrollContent) return
  scrollContent.scrollBy({ left: -scrollContent.clientWidth, behavior: 'smooth' })
})

openCartButton?.addEventListener('click', () => toggleCart(true))
closeCartButton?.addEventListener('click', () => toggleCart(false))
cartOverlay?.addEventListener('click', () => toggleCart(false))

checkoutButton?.addEventListener('click', () => {
  if (!cart.length) {
    alert('O teu carrinho está vazio.')
    return
  }

  alert('Compra simulada concluída com sucesso!')
  cart = []
  writeCartToStorage()
  renderCart()
  toggleCart(false)
})

document.addEventListener('click', (event) => {
  const addButton = event.target.closest('.add-cart-btn')
  if (addButton) {
    addProductToCart(addButton.dataset.productId)
    return
  }

  const quantityButton = event.target.closest('[data-action="qty"]')
  if (quantityButton) {
    changeItemQuantity(quantityButton.dataset.productId, Number(quantityButton.dataset.delta))
    return
  }

  const removeButton = event.target.closest('[data-action="remove"]')
  if (removeButton) {
    cart = cart.filter((item) => item.id !== removeButton.dataset.productId)
    writeCartToStorage()
    renderCart()
  }

  const filterButton = event.target.closest('.filter-btn')
  if (filterButton) {
    document.querySelectorAll('.filter-btn').forEach((button) => button.classList.toggle('active', button === filterButton))
    renderProducts()
  }
})

productSearch?.addEventListener('input', renderProducts)

document.addEventListener('DOMContentLoaded', () => {
  cart = readCartFromStorage()
  renderProducts()
  renderCart()
})

renderProducts()
renderCart()