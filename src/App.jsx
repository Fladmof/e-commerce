import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCartStorageKey } from './cart.js'
import { getReadMessages, getUnreadConversationIds, markConversationRead } from './messages.js'
import {
  emptyStylePreferences,
  normalizeStylePreferences,
  scoreStylePreference,
  stylePreferenceOptions
} from '../shared/style-preferences.js'

const fallbackProducts = [
  {
    id: 'tshirt-virgem',
    name: 'T-shirt Preta Virgem',
    category: 'camisetas',
    price: 120,
    oldPrice: 150,
    rating: 4,
    image: '/image/roupas/t_shert.png',
    description: 'T-shirt casual com corte moderno e material leve para uso diário.',
    featured: true,
    stock: 18
  },
  {
    id: 'calca-jeans',
    name: 'Calça Jeans',
    category: 'calcas',
    price: 240,
    oldPrice: 260,
    rating: 3,
    image: '/image/roupas/calça.png',
    description: 'Calça jeans clássica, confortável e versátil para qualquer look.',
    featured: true,
    stock: 22
  },
  {
    id: 'camisa-quadriculada',
    name: 'Camisa Quadriculada',
    category: 'camisetas',
    price: 180,
    oldPrice: 0,
    rating: 5,
    image: '/image/roupas/camisa.png',
    description: 'Design elegante e casual para elevar o teu visual diário.',
    featured: true,
    stock: 9
  }
]

const formatEuro = (value) =>
  new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(Number(value || 0))
const formatAoa = (value) =>
  Number.isFinite(Number(value))
    ? `${new Intl.NumberFormat('pt-AO', { maximumFractionDigits: 0 }).format(Math.round(Number(value)))} KZ`
    : 'Cotação indisponível'
const fulfillmentLabels = {
  processing: 'Por preparar',
  preparing: 'Em preparação',
  ready_to_ship: 'Pronta para envio',
  shipped: 'Expedida',
  delivered: 'Entregue',
  cancelled: 'Cancelada'
}
const returnLabels = {
  none: 'Sem devolução',
  requested: 'Solicitada',
  approved: 'Aprovada',
  rejected: 'Recusada',
  received: 'Recebida',
  refunded: 'Reembolsada'
}
const payoutLabels = {
  pending: 'Por pagar',
  paid: 'Pago',
  recovery_required: 'Recuperação necessária',
  recovered: 'Recuperado',
  cancelled: 'Cancelado'
}
const formatPrice = (value, exchangeRate) => exchangeRate
  ? formatAoa(Number(value || 0) * exchangeRate)
  : 'Cotação indisponível'
const productBaseAoa = (product, exchangeRate) => {
  if (product.priceCurrency === 'AOA') return Number(product.price)
  return exchangeRate ? Number(product.price) * exchangeRate : Number.NaN
}
const productCommissionAoa = (product, exchangeRate) => Math.round(productBaseAoa(product, exchangeRate) * 0.02)
const productTotalAoa = (product, exchangeRate) =>
  productBaseAoa(product, exchangeRate) + productCommissionAoa(product, exchangeRate)
const productBaseEur = (product, exchangeRate) =>
  product.priceCurrency === 'AOA'
    ? exchangeRate ? Number(product.price) / exchangeRate : 0
    : Number(product.price)
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')

const getImageUrl = (image) => {
  if (!image) return ''
  if (/^https?:\/\//i.test(image)) return image
  if (image.startsWith('/uploads/')) {
    return `${new URL(API_BASE, window.location.origin).origin}${image}`
  }
  if (image.startsWith('/image/')) {
    return `${import.meta.env.BASE_URL}${image.replace(/^\/+/, '')}`
  }
  return image
}

const getStoredValue = (key, fallback) => {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

const saveStoredValue = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value))
}

const getCurrentCoordinates = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) {
    reject(new Error('Este navegador não disponibiliza localização.'))
    return
  }
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
    (error) => reject(new Error(error.code === error.PERMISSION_DENIED
      ? 'A permissão de localização foi recusada.'
      : 'Não foi possível obter a localização atual.')),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  )
})

function ProfileAvatar({ user, className = '' }) {
  const initial = user?.name?.trim().charAt(0).toUpperCase() || '?'
  return (
    <span className={`profile-avatar${className ? ` ${className}` : ''}`} aria-hidden="true">
      {user?.profileImage
        ? <img src={getImageUrl(user.profileImage)} alt="" />
        : initial}
    </span>
  )
}

const normalizeProducts = (items) =>
  (Array.isArray(items) ? items : fallbackProducts).map((product) => ({
    ...product,
    featured: Boolean(product.featured),
    stock: Number(product.stock || 0),
    price: Number(product.price || 0),
    oldPrice: Number(product.oldPrice || 0),
    rating: Number(product.rating || 4)
  }))

async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('shopco-token')
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(data?.message || 'Erro na operação')
    error.status = response.status
    throw error
  }

  return data
}

function Navbar({ cartCount, currentUser, unreadMessageCount }) {
  return (
    <header className="header">
      <div className="container nav-wrap">
        <Link to="/" className="brand">SHOP.CO</Link>
        <nav className="main-nav">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/#catalogo">Catálogo</NavLink>
          <NavLink to="/#experiencias">Experiências</NavLink>
          <NavLink to="/checkout">Checkout</NavLink>
          {currentUser?.role === 'seller' ? <NavLink to="/vendedor">Vendedor</NavLink> : null}
          {currentUser && currentUser.role !== 'admin' ? (
            <NavLink to="/mensagens" className="messages-nav-link">
              Mensagens
              {unreadMessageCount ? <span className="unread-count">{unreadMessageCount}</span> : null}
            </NavLink>
          ) : null}
          {currentUser?.role === 'admin' ? <NavLink to="/admin">Admin</NavLink> : null}
        </nav>
        <div className="nav-actions">
          <Link to="/login" className="nav-link">
            {currentUser
              ? <><ProfileAvatar user={currentUser} className="nav-avatar" />{currentUser.name}</>
              : 'Entrar'}
          </Link>
          <Link to="/carrinho" className="cart-link" aria-label="Carrinho de compras">
            <span className="cart-icon">🛒</span>
            <span className="cart-badge">{cartCount}</span>
          </Link>
        </div>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <h3 className="brand footer-brand">SHOP.CO</h3>
          <p>Roupas premium para todos os estilos, pensadas para o teu dia a dia.</p>
        </div>
        <div>
          <h4>Empresa</h4>
          <ul>
            <li>Sobre nós</li>
            <li>Carreira</li>
            <li>Contactos</li>
          </ul>
        </div>
        <div>
          <h4>Ajuda</h4>
          <ul>
            <li>Suporte</li>
            <li>Entregas</li>
            <li>Termos</li>
          </ul>
        </div>
        <div>
          <h4>Conta</h4>
          <ul>
            <li>Iniciar sessão</li>
            <li>Pedidos</li>
            <li>Wishlist</li>
          </ul>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© 2026 Shop.co. Todos os direitos reservados.</span>
        <div className="payment-methods">VISA • MASTERCARD • PAYPAL</div>
      </div>
    </footer>
  )
}

function ProductCard({ product, exchangeRate, onAddToCart }) {
  const discount = product.oldPrice ? Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100) : 0

  return (
    <article className="product-card">
      <Link to={`/produto/${product.id}`} className="product-image-wrap">
        <img src={getImageUrl(product.image)} alt={product.name} className="product-image" />
      </Link>
      <div className="product-info">
        <div>
          <h3>{product.name}</h3>
          <p className="product-rating">{product.rating ? `⭐ ${product.rating}/5` : 'Sem avaliações'}</p>
        </div>
        <div className="product-price-row">
          <span className="current-price">{formatAoa(productTotalAoa(product, exchangeRate))}</span>
          {product.oldPrice ? <span className="old-price">{formatAoa(
            product.priceCurrency === 'AOA'
              ? product.oldPrice * 1.02
              : exchangeRate ? product.oldPrice * exchangeRate * 1.02 : 0
          )}</span> : null}
          {discount ? <span className="discount-badge">-{discount}%</span> : null}
        </div>
        <p className="commission-note">Inclui custo de intermediação (2%): {formatAoa(productCommissionAoa(product, exchangeRate))}</p>
        <p className="product-description">{product.description}</p>
        {product.sellerName ? <p className="seller-attribution">Vendido por {product.sellerName}</p> : null}
        <button type="button" className="primary-button" onClick={() => onAddToCart(product)} disabled={product.stock <= 0}>
          {product.stock <= 0 ? 'Sem stock' : 'Adicionar ao carrinho'}
        </button>
      </div>
    </article>
  )
}

function HomePage({
  products,
  onAddToCart,
  productsLoading,
  exchangeRate,
  exchangeRateUpdatedAt,
  reviews,
  reviewsLoading,
  currentUser,
  authChecking,
  onCreateReview
}) {
  const [search, setSearch] = useState('')
  const featured = products.filter((product) => product.featured)
  const preferences = normalizeStylePreferences(currentUser?.stylePreferences) || emptyStylePreferences
  const hasPreferences = preferences.categories.length > 0 ||
    preferences.styles.length > 0 ||
    preferences.colors.length > 0 ||
    preferences.budget !== 'any'
  const rankedProducts = hasPreferences
    ? products
      .map((product) => ({
        product,
        score: scoreStylePreference(
          product,
          preferences,
          product.priceCurrency === 'AOA' && !exchangeRate ? null : productBaseEur(product, exchangeRate)
        )
      }))
      .filter(({ product, score }) => score > 0 && product.stock > 0)
      .sort((left, right) =>
        right.score - left.score ||
        Number(right.product.featured) - Number(left.product.featured) ||
        right.product.rating - left.product.rating
      )
      .slice(0, 6)
      .map(({ product }) => product)
    : []
  const hasPersonalizedMatches = rankedProducts.length > 0
  const personalizedProducts = hasPersonalizedMatches ? rankedProducts : featured
  const matchingProducts = products.filter((product) =>
    `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(search.trim().toLowerCase())
  )
  const visibleProducts = search.trim() ? matchingProducts : personalizedProducts

  return (
    <>
      <section className="hero-section">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Coleção 2026</span>
            <h1>Encontra o teu estilo com peças que marcam presença.</h1>
            <p>Explore uma coleção premium de roupas e acessórios pensada para quem procura conforto, qualidade e presença.</p>
            <div className="hero-actions">
              <Link to="/#catalogo" className="primary-button">Comprar agora</Link>
              <Link to="/login" className="secondary-button">Entrar</Link>
            </div>
            <div className="hero-stats">
              <div><strong>+200</strong><span>Marcas</span></div>
              <div><strong>+2k</strong><span>Produtos</span></div>
              <div><strong>+30k</strong><span>Clientes</span></div>
            </div>
          </div>
          <div className="hero-media">
            <img src={getImageUrl('/image/couple.png')} alt="Casal com roupas de moda" />
          </div>
        </div>
      </section>

      <section className="brands-strip">
        <div className="container brands-row">
          <span>VERSACE</span>
          <span>ZARA</span>
          <span>GUCCI</span>
          <span>PRADA</span>
          <span>CALVIN KLEIN</span>
        </div>
      </section>

      <section id="catalogo" className="catalog-section container">
        <div className="section-heading">
          <h2>{search.trim()
            ? 'Resultados da pesquisa'
            : hasPersonalizedMatches ? 'Sugestões para ti' : 'Produtos em destaque'}</h2>
          <Link to="/checkout" className="text-link">Ir para checkout</Link>
        </div>
        {exchangeRate ? (
          <p className="currency-note">
            Preços indicativos em KZ, calculados à taxa de 1 EUR = {new Intl.NumberFormat('pt-AO', { maximumFractionDigits: 2 }).format(exchangeRate)} KZ
            {exchangeRateUpdatedAt ? ` (atualizada em ${new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short' }).format(new Date(exchangeRateUpdatedAt))})` : ''}.
            O checkout cobra em EUR.
          </p>
        ) : null}
        <label className="catalog-search">
          <span className="visually-hidden">Pesquisar produtos</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar produtos por nome, categoria ou descrição"
            aria-label="Pesquisar produtos"
          />
        </label>
        {!productsLoading && (
        <div className="product-grid">
          {visibleProducts.map((product) => (
            <ProductCard key={product.id} product={product} exchangeRate={exchangeRate} onAddToCart={onAddToCart} />
          ))}
        </div>
        )}
        {productsLoading ? <p role="status">A carregar produtos...</p> : null}
        {!productsLoading && visibleProducts.length === 0 ? <p className="empty-state">Não foram encontrados produtos.</p> : null}
      </section>

      <ReviewsSection
        reviews={reviews}
        reviewsLoading={reviewsLoading}
        currentUser={currentUser}
        authChecking={authChecking}
        onCreateReview={onCreateReview}
      />
    </>
  )
}

function ReviewsSection({ reviews, reviewsLoading, currentUser, authChecking, onCreateReview }) {
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return

    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      await onCreateReview(comment)
      setComment('')
      setSuccess('Obrigado por partilhares a tua experiência.')
    } catch (reviewError) {
      setError(reviewError.message || 'Não foi possível publicar o comentário.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section id="experiencias" className="container reviews-section">
      <div className="section-heading">
        <h2>Experiências de compra</h2>
        <span className="eyebrow">Opiniões de clientes</span>
      </div>
      <div className="reviews-layout">
        <div className="reviews-list">
          {reviewsLoading ? <p role="status">A carregar comentários...</p> : null}
          {!reviewsLoading && reviews.length === 0 ? <p className="empty-state">Ainda não há comentários. Sê o primeiro cliente a partilhar a tua experiência.</p> : null}
          {reviews.map((review) => (
            <article className="card review-card" key={review.id}>
              <p>{review.comment}</p>
              <div className="review-meta">
                <strong>{review.customerName}</strong>
                <time dateTime={review.createdAt}>
                  {new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium' }).format(new Date(review.createdAt))}
                </time>
              </div>
            </article>
          ))}
        </div>
        <div className="card review-form-card">
          <h3>Como foi a tua compra?</h3>
          {authChecking ? <p role="status">A validar a sessão...</p> : null}
          {!authChecking && currentUser?.role === 'customer' ? (
            <form onSubmit={handleSubmit}>
              <label>
                O teu comentário
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  minLength={3}
                  maxLength={2000}
                  rows={5}
                  required
                />
              </label>
              <p className="field-hint">A publicação está disponível para clientes com uma encomenda paga. Cada cliente pode publicar um comentário.</p>
              {error ? <p className="error-message" role="alert">{error}</p> : null}
              {success ? <p className="success-message" role="status">{success}</p> : null}
              <button type="submit" className="primary-button" disabled={submitting || comment.trim().length < 3}>
                {submitting ? 'A publicar...' : 'Publicar comentário'}
              </button>
            </form>
          ) : null}
          {!authChecking && !currentUser ? (
            <p>Inicia sessão e conclui uma compra para partilhares a tua experiência. <Link to="/login" className="text-link">Entrar</Link></p>
          ) : null}
          {!authChecking && currentUser && currentUser.role !== 'customer' ? (
            <p>Apenas clientes com uma encomenda paga podem publicar comentários.</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function ProductPage({ products, onAddToCart, productsLoading, exchangeRate, currentUser, onStartChat }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [chatError, setChatError] = useState('')
  const product = products.find((item) => item.id === id)

  if (productsLoading) {
    return <div className="container empty-state">A carregar produto...</div>
  }
  if (!product) {
    return <div className="container empty-state">Produto não encontrado.</div>
  }

  const discount = product.oldPrice ? Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100) : 0

  return (
    <div className="container product-page">
      <div className="product-detail-media">
        <img src={getImageUrl(product.image)} alt={product.name} />
      </div>
      <div className="product-detail-info">
        <span className="eyebrow">{product.category}</span>
        <h1>{product.name}</h1>
        <p className="product-rating">{product.rating ? `⭐ ${product.rating}/5` : 'Sem avaliações'}</p>
        <div className="product-price-row large">
          <span className="current-price">{formatAoa(productTotalAoa(product, exchangeRate))}</span>
          {product.oldPrice ? <span className="old-price">{formatAoa(
            product.priceCurrency === 'AOA'
              ? product.oldPrice * 1.02
              : exchangeRate ? product.oldPrice * exchangeRate * 1.02 : 0
          )}</span> : null}
          {discount ? <span className="discount-badge">-{discount}%</span> : null}
        </div>
        <p className="commission-note">Inclui custo de intermediação (2%): {formatAoa(productCommissionAoa(product, exchangeRate))}</p>
        <p className="detail-description">{product.description}</p>
        {product.sellerName ? <p>Vendido por <strong>{product.sellerName}</strong></p> : null}
        <div className="detail-meta">
          <span>Disponibilidade: {product.stock} em stock</span>
          <span>Entrega: 2-4 dias</span>
        </div>
        <button type="button" className="primary-button large" onClick={() => onAddToCart(product)} disabled={product.stock <= 0}>
          {product.stock <= 0 ? 'Sem stock' : 'Adicionar ao carrinho'}
        </button>
        {product.sellerId && currentUser?.role !== 'seller' ? (
          currentUser?.role === 'customer' ? (
            <button type="button" className="secondary-button" onClick={async () => {
              setChatError('')
              try {
                const conversationId = await onStartChat(product.id)
                navigate(`/chat/${conversationId}`)
              } catch (error) {
                setChatError(error.message || 'Não foi possível iniciar a conversa.')
              }
            }}>
              Falar com o vendedor
            </button>
          ) : !currentUser ? (
            <Link to={`/login?next=${encodeURIComponent(`/produto/${product.id}`)}`} className="secondary-button">
              Inicia sessão para falar com o vendedor
            </Link>
          ) : null
        ) : null}
        {chatError ? <p className="error-message" role="alert">{chatError}</p> : null}
      </div>
    </div>
  )
}

function CartPage({ cart, products, productsLoading, exchangeRate, onUpdateQuantity, onRemoveItem }) {
  const cartItems = cart
    .map((item) => {
      const product = products.find((entry) => entry.id === item.id)
      if (!product) return null
      return { ...product, quantity: item.quantity }
    })
    .filter(Boolean)

  const totalAoa = cartItems.reduce((sum, item) => sum + productTotalAoa(item, exchangeRate) * item.quantity, 0)
  return (
    <div className="container cart-page">
      <div className="cart-header-row">
        <h1>O teu carrinho</h1>
        <Link to="/" className="text-link">Continuar compras</Link>
      </div>

      {productsLoading ? (
        <div className="empty-state">A carregar carrinho...</div>
      ) : cartItems.length === 0 ? (
        <div className="empty-state">O teu carrinho está vazio.</div>
      ) : (
        <div className="cart-layout">
          <div className="cart-list">
            {cartItems.map((item) => (
              <div className="cart-item" key={item.id}>
                <img src={getImageUrl(item.image)} alt={item.name} />
                <div className="cart-item-info">
                  <h3>{item.name}</h3>
                  <p>{formatAoa(productTotalAoa(item, exchangeRate))}</p>
                  <p className="commission-note">Custo de intermediação (2%): {formatAoa(productCommissionAoa(item, exchangeRate))}</p>
                  <div className="quantity-controls">
                    <button type="button" onClick={() => onUpdateQuantity(item.id, -1)}>-</button>
                    <span>{item.quantity}</span>
                    <button type="button" onClick={() => onUpdateQuantity(item.id, 1)} disabled={item.quantity >= item.stock} aria-label={`Aumentar quantidade de ${item.name}`}>+</button>
                  </div>
                </div>
                <div className="cart-item-actions">
                  <strong>{formatAoa(productTotalAoa(item, exchangeRate) * item.quantity)}</strong>
                  <button type="button" className="link-button" onClick={() => onRemoveItem(item.id)}>Remover</button>
                </div>
              </div>
            ))}
          </div>

          <aside className="summary-card">
            <h3>Resumo</h3>
            <div className="summary-row"><span>Subtotal com intermediação</span><strong>{formatAoa(totalAoa)}</strong></div>
            <div className="summary-row"><span>Envio</span><strong>Calculado no checkout</strong></div>
            <div className="summary-row total"><span>Subtotal</span><strong>{formatAoa(totalAoa)}</strong></div>
            <p className="currency-note">O envio depende da distância rodoviária e será calculado no checkout.</p>
            <Link to="/checkout" className="primary-button full-width">Finalizar compra</Link>
          </aside>
        </div>
      )}
    </div>
  )
}

function CheckoutPage({ cart, products, productsLoading, currentUser, authChecking, exchangeRate, onCreateCheckout }) {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [buyerLocation, setBuyerLocation] = useState(null)
  const [locationError, setLocationError] = useState('')
  const [shippingQuote, setShippingQuote] = useState(null)
  const [shippingQuoteError, setShippingQuoteError] = useState('')
  const [shippingQuoteLoading, setShippingQuoteLoading] = useState(false)
  const location = useLocation()
  const cartItems = cart
    .map((item) => {
      const product = products.find((entry) => entry.id === item.id)
      if (!product) return null
      return { ...product, quantity: item.quantity }
    })
    .filter(Boolean)

  const subtotalAoa = cartItems.reduce((sum, item) => sum + productTotalAoa(item, exchangeRate) * item.quantity, 0)
  const commissionAoa = cartItems.reduce((sum, item) => sum + productCommissionAoa(item, exchangeRate) * item.quantity, 0)
  const subtotalEur = cartItems.reduce((sum, item) => sum + productBaseEur(item, exchangeRate) * 1.02 * item.quantity, 0)
  const cartItemsKey = JSON.stringify(cartItems.map((item) => ({ id: item.id, quantity: item.quantity })))

  useEffect(() => {
    if (!buyerLocation || !currentUser || !cartItems.length) return undefined
    let active = true
    setShippingQuote(null)
    setShippingQuoteError('')
    setShippingQuoteLoading(true)
    apiFetch('/shipping/quote', {
      method: 'POST',
      body: JSON.stringify({
        items: JSON.parse(cartItemsKey),
        buyerLocation
      })
    }).then((quote) => {
      if (active) setShippingQuote(quote)
    }).catch((quoteError) => {
      if (active) setShippingQuoteError(quoteError.message || 'Não foi possível calcular o custo de envio.')
    }).finally(() => {
      if (active) setShippingQuoteLoading(false)
    })
    return () => { active = false }
  }, [buyerLocation, cartItems.length, cartItemsKey, currentUser])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!cartItems.length || !currentUser || !buyerLocation || !shippingQuote || submitting) return

    setSubmitting(true)
    setError('')
    try {
      const { url } = await onCreateCheckout({
        items: cartItems.map((item) => ({ id: item.id, quantity: item.quantity })),
        buyerLocation
      })
      window.location.assign(url)
    } catch (error) {
      setError(error.message || 'Não foi possível iniciar o pagamento.')
      setSubmitting(false)
    }
  }

  const requestLocation = async () => {
    setLocationError('')
    setShippingQuote(null)
    try {
      setBuyerLocation(await getCurrentCoordinates())
    } catch (geoError) {
      setLocationError(geoError.message)
    }
  }

  if (productsLoading) {
    return <div className="container empty-state">A carregar checkout...</div>
  }

  if (!cartItems.length) {
    return <div className="container empty-state">Nenhum produto no carrinho. <Link to="/" className="text-link">Voltar ao catálogo</Link></div>
  }

  if (authChecking) {
    return <div className="container empty-state">A validar a sessão...</div>
  }

  if (!currentUser) {
    return (
      <div className="container checkout-page">
        <div className="card checkout-notice">
          <h1>Inicia sessão para continuar</h1>
          <p>As encomendas ficam associadas à tua conta. O carrinho será mantido durante o início de sessão.</p>
          <Link to={`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`} className="primary-button">
            Entrar para pagar
          </Link>
        </div>
      </div>
    )
  }

  if (currentUser.role !== 'customer') {
    return (
      <div className="container checkout-page">
        <div className="card checkout-notice">
          <h1>Checkout disponível para clientes</h1>
          <p>As contas de vendedor servem para publicar produtos e conversar com clientes.</p>
          <Link to="/vendedor" className="primary-button">Voltar ao painel do vendedor</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container checkout-page">
      <h1>Checkout</h1>
      <form className="checkout-layout" onSubmit={handleSubmit}>
        <section className="checkout-form card">
          <h2>Pagamento seguro</h2>
          <p>O pagamento e os dados de entrega são recolhidos de forma segura pelo Stripe. Os dados do cartão não passam por esta loja.</p>
          <p>Os preços e a comissão são apresentados em KZ. O Stripe cobrará o valor convertido em euros abaixo.</p>
          {exchangeRate ? <p className="currency-note">Taxa usada nesta estimativa: 1 EUR = {new Intl.NumberFormat('pt-AO', { maximumFractionDigits: 2 }).format(exchangeRate)} KZ.</p> : null}
          <h3>Calcular envio</h3>
          <p>A localização atual só é recolhida quando autorizares. As coordenadas não são guardadas pela loja, mas são enviadas ao OpenRouteService para calcular o percurso por estrada.</p>
          <button type="button" className="secondary-button" onClick={requestLocation}>
            {buyerLocation ? 'Atualizar localização' : 'Usar a minha localização'}
          </button>
          {locationError ? <p className="error-message" role="alert">{locationError}</p> : null}
          {shippingQuoteLoading ? <p role="status">A calcular a distância e o custo de envio...</p> : null}
          {shippingQuoteError ? <p className="error-message" role="alert">{shippingQuoteError}</p> : null}
          {shippingQuote ? (
            <div className="shipping-quotes">
              {shippingQuote.sellers.map((seller) => (
                <p key={seller.sellerId || 'shop'}>
                  {seller.sellerName}: {seller.distanceKm === null
                    ? 'taxa base'
                    : `${seller.distanceKm} km por estrada`}
                  {' — '}{formatAoa(seller.deliveryFeeAoa)}
                </p>
              ))}
            </div>
          ) : null}
          <p className="charge-amount">Envio: <strong>{shippingQuote ? formatAoa(shippingQuote.totalAoa) : 'A calcular'}</strong></p>
          <p className="charge-amount">Total estimado a cobrar: <strong>{formatEuro(subtotalEur + (shippingQuote?.shippingEur || 0))}</strong></p>
          <p>Conta: <strong>{currentUser.email}</strong></p>
          {error ? <p className="error-message" role="alert">{error}</p> : null}
          {new URLSearchParams(location.search).has('cancelled') ? (
            <p className="error-message" role="status">Pagamento cancelado. O carrinho continua guardado.</p>
          ) : null}
        </section>
        <aside className="summary-card">
          <h3>Resumo do pedido</h3>
          {cartItems.map((item) => (
            <div className="summary-item" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>Qtd: {item.quantity}</span>
              </div>
              <span>{formatAoa(productTotalAoa(item, exchangeRate) * item.quantity)}</span>
            </div>
          ))}
          <div className="summary-row"><span>Custo de intermediação (2%)</span><strong>{formatAoa(commissionAoa)}</strong></div>
          <div className="summary-row"><span>Subtotal com intermediação</span><strong>{formatAoa(subtotalAoa)}</strong></div>
          <div className="summary-row"><span>Envio</span><strong>{shippingQuote ? formatAoa(shippingQuote.totalAoa) : 'A calcular'}</strong></div>
          <div className="summary-row total"><span>Total estimado em KZ</span><strong>{formatAoa(subtotalAoa + (shippingQuote?.totalAoa || 0))}</strong></div>
          <button type="submit" className="primary-button full-width" disabled={submitting || !shippingQuote || shippingQuoteLoading}>
            {submitting ? 'A redirecionar...' : 'Continuar para pagamento'}
          </button>
        </aside>
      </form>
    </div>
  )
}

function SuccessPage({ currentUser, authChecking, exchangeRate, onConfirmPayment }) {
  const location = useLocation()
  const navigate = useNavigate()
  const attemptedSession = useRef('')
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const sessionId = new URLSearchParams(location.search).get('session_id')

  useEffect(() => {
    if (authChecking || !sessionId) return
    if (!currentUser) {
      navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, { replace: true })
      return
    }
    if (attemptedSession.current === sessionId) return
    attemptedSession.current = sessionId
    onConfirmPayment(sessionId).then(setOrder).catch((confirmationError) => {
      setError(confirmationError.message || 'Não foi possível confirmar o pagamento.')
    })
  }, [authChecking, currentUser, location.pathname, location.search, navigate, onConfirmPayment, retry, sessionId])

  return (
    <div className="container success-page">
      <div className="success-card">
        {authChecking ? <h1>A validar pagamento...</h1> : null}
        {!authChecking && !sessionId ? (
          <>
            <h1>Não foi indicada uma sessão de pagamento</h1>
            <p>Confirma o estado da encomenda na tua conta ou volta à loja.</p>
          </>
        ) : null}
        {!order && !error && sessionId ? <h1>A confirmar o pagamento...</h1> : null}
        {order ? (
          <>
            <h1>Pedido confirmado</h1>
            <p>Encomenda {order.id} recebida. Total pago: {formatEuro(order.total)} ({formatPrice(order.total, exchangeRate)} à taxa atual).</p>
          </>
        ) : null}
        {error ? <p className="error-message" role="alert">{error}</p> : null}
        <Link to="/" className="primary-button">Voltar à loja</Link>
      </div>
    </div>
  )
}

function LoginPage({ currentUser, onLogin, onLogout, onUpdateProfileImage }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [uploadingProfileImage, setUploadingProfileImage] = useState(false)
  const requestedPath = new URLSearchParams(location.search).get('next')
  const destination = requestedPath?.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/'

  const handleProfileImageChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setProfileError('')
    setProfileMessage('')
    if (file.size > 5 * 1024 * 1024) {
      setProfileError('A imagem deve ter no máximo 5 MB.')
      event.target.value = ''
      return
    }
    setUploadingProfileImage(true)
    try {
      const response = await onUpdateProfileImage(file)
      setProfileMessage(response.warning || 'Foto de perfil atualizada.')
    } catch (uploadError) {
      setProfileError(uploadError.message || 'Não foi possível atualizar a foto de perfil.')
    } finally {
      setUploadingProfileImage(false)
      event.target.value = ''
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    try {
      const user = await onLogin(email, password)
      navigate(requestedPath?.startsWith('/') && !requestedPath.startsWith('//')
        ? destination
        : user.role === 'seller' ? '/vendedor' : '/', { replace: true })
    } catch (e) {
      setError(e.message || 'Erro ao iniciar sessão')
    }
  }

  if (currentUser) {
    return (
      <div className="container auth-panel">
        <div className="card auth-card">
          <h1>Bem-vindo</h1>
          <div className="profile-settings">
            <ProfileAvatar user={currentUser} className="profile-avatar-large" />
            <div className="profile-settings-content">
              <p>Foto de perfil de <strong>{currentUser.name}</strong></p>
              <label className="secondary-button profile-upload-button">
                {uploadingProfileImage ? 'A carregar...' : 'Escolher foto'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleProfileImageChange}
                  disabled={uploadingProfileImage}
                />
              </label>
            </div>
          </div>
          {profileError ? <p className="error-message" role="alert">{profileError}</p> : null}
          {profileMessage ? <p className="status-message profile-upload-status" role="status">{profileMessage}</p> : null}
          <p>Estás autenticado como <strong>{currentUser.name}</strong>.</p>
          <p>{currentUser.role === 'admin' ? 'Podes gerir o painel admin.' : 'Podes continuar as compras.'}</p>
          <button type="button" className="primary-button" onClick={onLogout}>Terminar sessão</button>
        </div>
      </div>
    )
  }

  return (
    <div className="container auth-panel">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1>Entrar</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Palavra-passe
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {error ? <p className="error-message" role="alert">{error}</p> : null}
        <button type="submit" className="primary-button full-width">Entrar</button>
        <p>Ainda não tens conta? <Link to="/registo" className="text-link">Criar conta</Link></p>
      </form>
    </div>
  )
}

function RegisterPage({ onRegister }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'customer',
    stylePreferences: { ...emptyStylePreferences }
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const togglePreference = (group, value) => {
    setForm((current) => {
      const selected = current.stylePreferences[group]
      return {
        ...current,
        stylePreferences: {
          ...current.stylePreferences,
          [group]: selected.includes(value)
            ? selected.filter((item) => item !== value)
            : [...selected, value]
        }
      }
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const user = await onRegister(form)
      navigate(user.role === 'seller' ? '/vendedor' : '/', { replace: true })
    } catch (registrationError) {
      setError(registrationError.message || 'Não foi possível criar a conta.')
      setSubmitting(false)
    }
  }

  return (
    <div className="container auth-panel">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1>Criar conta</h1>
        <label>
          Nome completo
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            autoComplete="name"
            maxLength={100}
            required
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <label>
          Tipo de conta
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
            <option value="customer">Cliente</option>
            <option value="seller">Vendedor</option>
          </select>
        </label>
        {form.role === 'customer' ? (
          <section className="style-questionnaire" aria-labelledby="style-questionnaire-title">
            <div>
              <h2 id="style-questionnaire-title">Descobre o teu estilo</h2>
              <p>As tuas respostas ajudam-nos a escolher sugestões mais ao teu gosto.</p>
            </div>
            {Object.entries(stylePreferenceOptions).map(([group, options]) => {
              const titles = {
                categories: 'O que gostas de comprar?',
                styles: 'Que estilos preferes?',
                colors: 'Que cores costumas escolher?'
              }
              return (
                <fieldset className="preference-group" key={group}>
                  <legend>{titles[group]}</legend>
                  <div className="preference-options">
                    {options.map((option) => (
                      <label className="preference-option" key={option.value}>
                        <input
                          type="checkbox"
                          checked={form.stylePreferences[group].includes(option.value)}
                          onChange={() => togglePreference(group, option.value)}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )
            })}
            <label>
              Qual é o teu orçamento habitual?
              <select
                value={form.stylePreferences.budget}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  stylePreferences: { ...current.stylePreferences, budget: event.target.value }
                }))}
              >
                <option value="any">Sem preferência</option>
                <option value="under-50">Até 50 €</option>
                <option value="50-100">Entre 50 € e 100 €</option>
                <option value="over-100">Mais de 100 €</option>
              </select>
            </label>
            <p className="field-hint">Podes deixar as opções em branco; serão usadas para ordenar as sugestões.</p>
          </section>
        ) : null}
        <label>
          Palavra-passe (8 a 72 caracteres)
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
          />
        </label>
        {error ? <p className="error-message" role="alert">{error}</p> : null}
        <button type="submit" className="primary-button full-width" disabled={submitting}>
          {submitting ? 'A criar conta...' : 'Criar conta'}
        </button>
        <p>Já tens conta? <Link to="/login" className="text-link">Iniciar sessão</Link></p>
      </form>
    </div>
  )
}
function AdminPage({ products, pendingProducts, onApproveProduct, onSaveProduct, onDeleteProduct, onLogout }) {
  const [dashboard, setDashboard] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState('')
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState(null)
  const [period, setPeriod] = useState(30)
  const [operationDrafts, setOperationDrafts] = useState({})
  const [payoutReferences, setPayoutReferences] = useState({})
  const [operationError, setOperationError] = useState('')
  const [operationMessage, setOperationMessage] = useState('')
  const [savingOperationId, setSavingOperationId] = useState('')
  const [form, setForm] = useState({
    id: '',
    name: '',
    category: 'camisetas',
    price: 0,
    priceCurrency: 'EUR',
    oldPrice: 0,
    image: '/image/roupas/t_shert.png',
    description: '',
    stock: 0,
    featured: false
  })
  const [uploadMessage, setUploadMessage] = useState('')
  const [approvalError, setApprovalError] = useState('')

  const loadDashboard = useCallback(async () => {
    setDashboardError('')
    setDashboardLoading(true)
    try {
      setDashboard(await apiFetch(`/admin/dashboard?period=${period}`))
      setDashboardUpdatedAt(new Date())
    } catch (error) {
      setDashboardError(error.message || 'Não foi possível carregar os indicadores operacionais.')
    } finally {
      setDashboardLoading(false)
    }
  }, [period])

  useEffect(() => {
    loadDashboard()
    const timer = window.setInterval(loadDashboard, 60000)
    return () => window.clearInterval(timer)
  }, [loadDashboard])

  const runOperation = async (id, endpoint, options, successMessage) => {
    setSavingOperationId(id)
    setOperationError('')
    setOperationMessage('')
    try {
      const result = await apiFetch(endpoint, options)
      setOperationMessage(result.message || successMessage)
      setOperationDrafts((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setPayoutReferences((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      await loadDashboard()
    } catch (error) {
      setOperationError(error.message || 'Não foi possível guardar a operação.')
    } finally {
      setSavingOperationId('')
    }
  }

  const updateOperationDraft = (order, key, value) => {
    setOperationDrafts((current) => ({
      ...current,
      [order.id]: {
        fulfillmentStatus: order.fulfillmentStatus,
        carrier: order.carrier,
        trackingNumber: order.trackingNumber,
        returnStatus: order.returnStatus,
        returnReason: order.returnReason,
        returnCarrier: order.returnCarrier,
        returnTrackingNumber: order.returnTrackingNumber,
        ...current[order.id],
        [key]: value
      }
    }))
  }

  const chartRows = useMemo(() => {
    if (!dashboard || period <= 30) return dashboard?.dailyOrders || []
    const groups = []
    for (let index = 0; index < dashboard.dailyOrders.length; index += 7) {
      const days = dashboard.dailyOrders.slice(index, index + 7)
      groups.push({
        ...days[days.length - 1],
        revenue: days.reduce((total, day) => total + day.revenue, 0),
        paidOrders: days.reduce((total, day) => total + day.paidOrders, 0)
      })
    }
    return groups
  }, [dashboard, period])

  const fulfillmentQueue = dashboard
    ? Object.entries(dashboard.fulfillment).filter(([status]) => status !== 'cancelled')
    : []
  const payoutTotals = dashboard?.payouts.reduce((totals, payout) => {
    const key = `${payout.status}:${payout.currency}`
    totals[key] = (totals[key] || 0) + payout.amount
    return totals
  }, {}) || {}

  const handleSubmit = async (event) => {
    event.preventDefault()
    try {
      await onSaveProduct(form)
      setForm({
        id: '',
        name: '',
        category: 'camisetas',
        price: 0,
        priceCurrency: 'EUR',
        oldPrice: 0,
        image: '/image/roupas/t_shert.png',
        description: '',
        stock: 0,
        featured: false
      })
      setUploadMessage('Produto guardado com sucesso.')
    } catch (error) {
      setUploadMessage(error.message || 'Erro ao guardar produto')
    }
  }

  const handleUpload = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    const formData = new FormData()
    formData.append('image', file)

    try {
      const data = await apiFetch('/admin/upload', { method: 'POST', headers: {}, body: formData })
      setForm((previous) => ({ ...previous, image: data.url }))
      setUploadMessage('Imagem carregada com sucesso.')
    } catch (error) {
      setUploadMessage(error.message || 'Erro no upload')
    }
  }

  return (
    <div className="container admin-page">
      <div className="admin-header">
        <h1>Painel de administração</h1>
        <div className="admin-actions">
          <button type="button" className="secondary-button" onClick={loadDashboard} disabled={dashboardLoading}>
            {dashboardLoading ? 'A atualizar...' : 'Atualizar dados'}
          </button>
          <button type="button" className="secondary-button" onClick={onLogout}>Sair</button>
        </div>
      </div>

      <section className="admin-dashboard" aria-labelledby="admin-dashboard-title">
        <div className="admin-section-heading">
          <div>
            <h2 id="admin-dashboard-title">Visão da cadeia de valor</h2>
            <p>Fornecedores, catálogo, stock, encomendas, expedição, devoluções e tesouraria · atualização a cada minuto</p>
          </div>
          <div className="dashboard-period-controls">
            <label>
              Período de análise
              <select value={period} onChange={(event) => setPeriod(Number(event.target.value))}>
                <option value={7}>7 dias</option>
                <option value={30}>30 dias</option>
                <option value={90}>90 dias</option>
              </select>
            </label>
            {dashboardUpdatedAt ? <span>Atualizado às {new Intl.DateTimeFormat('pt-PT', {
              hour: '2-digit',
              minute: '2-digit'
            }).format(dashboardUpdatedAt)}</span> : null}
          </div>
        </div>
        {dashboardError ? <p className="error-message" role="alert">{dashboardError}</p> : null}
        {operationError ? <p className="error-message" role="alert">{operationError}</p> : null}
        {operationMessage ? <p className="status-message" role="status">{operationMessage}</p> : null}
        {dashboardLoading && !dashboard ? <p role="status">A carregar indicadores operacionais...</p> : null}
        {dashboard ? (
          <>
            <div className="dashboard-kpis">
              <article className="card dashboard-kpi">
                <span>Vendas · {period} dias</span>
                <strong>{formatEuro(dashboard.summary.revenueInPeriod)}</strong>
                <small>{dashboard.summary.paidOrdersInPeriod} encomendas pagas</small>
              </article>
              <article className="card dashboard-kpi">
                <span>Vendas acumuladas</span>
                <strong>{formatEuro(dashboard.summary.revenue)}</strong>
                <small>{dashboard.summary.paidOrders} pagamentos · {dashboard.summary.refundedOrders} reembolsos</small>
              </article>
              <article className="card dashboard-kpi">
                <span>Comissão acumulada</span>
                <strong>{formatEuro(dashboard.summary.commission)}</strong>
                <small>Receita da plataforma em encomendas pagas</small>
              </article>
              <article className="card dashboard-kpi">
                <span>Valor médio · {period} dias</span>
                <strong>{formatEuro(dashboard.summary.paidOrdersInPeriod
                  ? dashboard.summary.revenueInPeriod / dashboard.summary.paidOrdersInPeriod
                  : 0)}</strong>
                <small>Inclui portes e comissão</small>
              </article>
              <article className="card dashboard-kpi">
                <span>Envios cobrados acumulados</span>
                <strong>{formatEuro(dashboard.summary.shipping)}</strong>
                <small>Incluídos nas encomendas pagas</small>
              </article>
              <article className="card dashboard-kpi">
                <span>Clientes</span>
                <strong>{dashboard.summary.customers}</strong>
                <small>Contas registadas</small>
              </article>
              <article className="card dashboard-kpi">
                <span>Fornecedores / vendedores</span>
                <strong>{dashboard.summary.sellers}</strong>
                <small>{dashboard.summary.approvedProducts} publicados · {dashboard.summary.pendingProducts} por aprovar</small>
              </article>
              <article className="card dashboard-kpi">
                <span>Stock disponível</span>
                <strong>{dashboard.summary.stockUnits}</strong>
                <small>{dashboard.summary.lowStock} baixo · {dashboard.summary.outOfStock} esgotados</small>
              </article>
              <article className="card dashboard-kpi">
                <span>Checkout / pagamento</span>
                <strong>{dashboard.summary.checkoutsAwaitingConfirmation}</strong>
                <small>Pagamentos por confirmar</small>
              </article>
              <article className="card dashboard-kpi">
                <span>Repasses pendentes</span>
                <strong>{formatAoa(payoutTotals['pending:AOA'] || 0)}</strong>
                <small>{formatEuro(payoutTotals['pending:EUR'] || 0)} em EUR</small>
              </article>
            </div>

            <section className="card dashboard-panel">
              <h3>Fluxo de encomendas</h3>
              <div className="dashboard-status-grid">
                {fulfillmentQueue.map(([status, count]) => (
                  <article className={`dashboard-status-card dashboard-status-${status}`} key={status}>
                    <span>{fulfillmentLabels[status] || status}</span>
                    <strong>{count}</strong>
                  </article>
                ))}
              </div>
              <div className="dashboard-status-grid dashboard-return-statuses">
                {Object.entries(dashboard.returns)
                  .filter(([status]) => status !== 'none')
                  .map(([status, count]) => (
                    <article className={`dashboard-status-card dashboard-status-${status}`} key={status}>
                      <span>Devoluções · {returnLabels[status] || status}</span>
                      <strong>{count}</strong>
                    </article>
                  ))}
              </div>
              <div className="dashboard-payout-summary">
                {dashboard.payouts.map((payout) => (
                  <span key={`${payout.status}:${payout.currency}`}>
                    {payoutLabels[payout.status]} · {payout.count}: {payout.currency === 'AOA'
                      ? formatAoa(payout.amount)
                      : formatEuro(payout.amount)}
                  </span>
                ))}
              </div>
            </section>

            <div className="dashboard-detail-grid">
              <section className="card dashboard-panel">
                <h3>Vendas · {period} dias</h3>
                <div className="dashboard-chart" role="img" aria-label={`Vendas dos últimos ${period} dias`}>
                  {chartRows.map((day) => {
                    const maxRevenue = Math.max(...chartRows.map((entry) => entry.revenue))
                    const barHeight = maxRevenue > 0 ? (day.revenue / maxRevenue) * 100 : 0
                    const date = new Date(`${day.day}T12:00:00`)
                    return (
                      <div className="dashboard-chart-day" key={day.day} title={`${day.paidOrders} encomendas · ${formatEuro(day.revenue)}`}>
                        <strong>{formatEuro(day.revenue)}</strong>
                        <div className="dashboard-chart-track">
                          <span className="dashboard-chart-bar" style={{ height: `${barHeight}%` }} />
                        </div>
                        <span>{period > 30
                          ? new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short' }).format(date)
                          : new Intl.DateTimeFormat('pt-PT', { weekday: 'short', day: '2-digit' }).format(date)}</span>
                      </div>
                    )
                  })}
                </div>
                <p className="field-hint">O valor inclui os portes e a comissão das encomendas pagas.</p>
              </section>

              <section className="card dashboard-panel">
                <h3>Produtos mais vendidos · {period} dias</h3>
                {dashboard.topProducts.length ? (
                  <ol className="dashboard-top-products">
                    {dashboard.topProducts.map((product) => (
                      <li key={product.id || product.name}>
                        <span>{product.name}</span>
                        <strong>{product.unitsSold} un.</strong>
                      </li>
                    ))}
                  </ol>
                ) : <p>Ainda não existem vendas neste período.</p>}
              </section>
            </div>

            <section className="card dashboard-panel dashboard-orders-panel">
              <h3>Alertas de inventário</h3>
              {dashboard.inventoryAlerts.length ? (
                <div className="dashboard-table-wrap">
                  <table className="dashboard-orders-table">
                    <thead>
                      <tr><th>Produto</th><th>Categoria</th><th>Fornecedor</th><th>Disponível</th></tr>
                    </thead>
                    <tbody>
                      {dashboard.inventoryAlerts.map((product) => (
                        <tr key={product.id}>
                          <td>{product.name}</td>
                          <td>{product.category}</td>
                          <td>{product.sellerName}</td>
                          <td><span className={product.stock === 0 ? 'inventory-out' : 'inventory-low'}>
                            {product.stock === 0 ? 'Esgotado' : `${product.stock} un.`}
                          </span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p>Não há alertas de stock neste momento.</p>}
            </section>

            <section className="card dashboard-panel dashboard-orders-panel">
              <h3>Desempenho dos fornecedores</h3>
              {dashboard.suppliers.length ? (
                <div className="dashboard-table-wrap">
                  <table className="dashboard-orders-table">
                    <thead>
                      <tr><th>Fornecedor</th><th>Produtos</th><th>Stock</th><th>Pedidos</th><th>Unidades vendidas</th><th>Repasses pendentes</th></tr>
                    </thead>
                    <tbody>
                      {dashboard.suppliers.map((supplier) => (
                        <tr key={supplier.id}>
                          <td><strong>{supplier.name}</strong><br /><small>{supplier.email}</small></td>
                          <td>{supplier.approvedProducts} publicados · {supplier.pendingProducts} por aprovar</td>
                          <td>{supplier.stockUnits} un. · {supplier.lowStock} baixos</td>
                          <td>{supplier.orders}</td>
                          <td>{supplier.unitsSold}</td>
                          <td>{supplier.pendingPayouts} · {supplier.recoveries} recuperações</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p>Ainda não existem fornecedores registados.</p>}
            </section>

            <section className="card dashboard-panel dashboard-orders-panel">
              <h3>Operações por encomenda</h3>
              <p>Atualiza preparação e envio, regista devoluções, confirma reembolsos Stripe e repõe artigos recebidos.</p>
              <div className="dashboard-operation-list">
                {dashboard.operations.map((order) => {
                  const draft = {
                    fulfillmentStatus: order.fulfillmentStatus,
                    carrier: order.carrier,
                    trackingNumber: order.trackingNumber,
                    returnStatus: order.returnStatus,
                    returnReason: order.returnReason,
                    returnCarrier: order.returnCarrier,
                    returnTrackingNumber: order.returnTrackingNumber,
                    ...operationDrafts[order.id]
                  }
                  const availableReturnStatuses = order.returnStatus === 'none'
                    ? ['none', 'requested']
                    : order.returnStatus === 'requested'
                      ? ['requested', 'approved', 'rejected']
                      : order.returnStatus === 'rejected'
                        ? ['rejected', 'requested']
                        : order.returnStatus === 'approved'
                          ? ['approved', 'received']
                          : [order.returnStatus]
                  const isSaving = savingOperationId === order.id
                  return (
                    <details className="dashboard-operation" key={order.id}>
                      <summary>
                        <span><strong>{order.id}</strong> · {order.customerName} · {formatEuro(order.total)}</span>
                        <span>{order.status === 'paid' ? 'Paga' : 'Reembolsada'} · {fulfillmentLabels[order.fulfillmentStatus]}</span>
                      </summary>
                      <div className="dashboard-operation-body">
                        <p>{order.itemSummary || 'Artigos removidos do catálogo'} · Criada em {new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short' }).format(new Date(order.createdAt))}</p>
                        {order.deliveryAddress || order.customerEmail ? (
                          <p>Entrega: {order.deliveryAddress || 'Morada não disponível'}{order.customerEmail ? ` · ${order.customerEmail}` : ''}</p>
                        ) : null}
                        <div className="dashboard-operation-grid">
                          <label>
                            Estado logístico
                            <select
                              value={draft.fulfillmentStatus}
                              disabled={order.status !== 'paid' || order.fulfillmentStatus === 'cancelled'}
                              onChange={(event) => updateOperationDraft(order, 'fulfillmentStatus', event.target.value)}
                            >
                              {Object.entries(fulfillmentLabels)
                                .filter(([status]) => status !== 'cancelled' || order.fulfillmentStatus === 'cancelled')
                                .map(([status, label]) => <option value={status} key={status}>{label}</option>)}
                            </select>
                          </label>
                          <label>
                            Transportadora
                            <input
                              maxLength={100}
                              value={draft.carrier}
                              onChange={(event) => updateOperationDraft(order, 'carrier', event.target.value)}
                            />
                          </label>
                          <label>
                            Código de rastreio
                            <input
                              maxLength={200}
                              value={draft.trackingNumber}
                              onChange={(event) => updateOperationDraft(order, 'trackingNumber', event.target.value)}
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={isSaving || order.status !== 'paid'}
                          onClick={() => runOperation(
                            order.id,
                            `/admin/orders/${encodeURIComponent(order.id)}/fulfillment`,
                            {
                              method: 'PATCH',
                              body: JSON.stringify({
                                status: draft.fulfillmentStatus,
                                carrier: draft.carrier,
                                trackingNumber: draft.trackingNumber
                              })
                            },
                            'Estado de expedição atualizado.'
                          )}
                        >Guardar expedição</button>

                        <div className="dashboard-operation-grid">
                          <label>
                            Estado da devolução
                            <select
                              value={draft.returnStatus}
                              disabled={order.status !== 'paid' || order.returnStatus === 'refunded'}
                              onChange={(event) => updateOperationDraft(order, 'returnStatus', event.target.value)}
                            >
                              {availableReturnStatuses.map((status) => (
                                <option value={status} key={status}>{returnLabels[status] || status}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Motivo / observação
                            <input
                              maxLength={500}
                              value={draft.returnReason}
                              onChange={(event) => updateOperationDraft(order, 'returnReason', event.target.value)}
                            />
                          </label>
                          <label>
                            Transportadora da devolução
                            <input
                              maxLength={100}
                              value={draft.returnCarrier}
                              onChange={(event) => updateOperationDraft(order, 'returnCarrier', event.target.value)}
                            />
                          </label>
                          <label>
                            Rastreio da devolução
                            <input
                              maxLength={200}
                              value={draft.returnTrackingNumber}
                              onChange={(event) => updateOperationDraft(order, 'returnTrackingNumber', event.target.value)}
                            />
                          </label>
                        </div>
                        <div className="dashboard-operation-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={isSaving || order.status !== 'paid' || order.returnStatus === 'refunded'}
                            onClick={() => runOperation(
                              order.id,
                              `/admin/orders/${encodeURIComponent(order.id)}/returns`,
                              {
                                method: 'PATCH',
                                body: JSON.stringify({
                                  status: draft.returnStatus,
                                  reason: draft.returnReason,
                                  carrier: draft.returnCarrier,
                                  trackingNumber: draft.returnTrackingNumber
                                })
                              },
                              'Estado da devolução atualizado.'
                            )}
                          >Guardar devolução</button>
                          {order.status === 'paid' ? (
                            <button
                              type="button"
                              className="danger-button"
                              disabled={isSaving || ['requested', 'approved'].includes(order.returnStatus)}
                              onClick={() => {
                                if (window.confirm(`Confirmas o reembolso total de ${formatEuro(order.total)} no Stripe?`)) {
                                  runOperation(
                                    order.id,
                                    `/admin/orders/${encodeURIComponent(order.id)}/refund`,
                                    { method: 'POST' },
                                    'Reembolso solicitado ao Stripe.'
                                  )
                                }
                              }}
                            >{order.refundStatus === 'pending' ? 'Verificar reembolso Stripe' : 'Reembolsar no Stripe'}</button>
                          ) : null}
                          {order.status === 'refunded' && order.returnStatus === 'refunded' && order.returnRequestedAt ? (
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={isSaving || Boolean(order.restockedAt)}
                              onClick={() => runOperation(
                                order.id,
                                `/admin/orders/${encodeURIComponent(order.id)}/restock`,
                                { method: 'POST' },
                                'Artigos repostos no stock.'
                              )}
                            >{order.restockedAt ? 'Stock reposto' : 'Repor artigos no stock'}</button>
                          ) : null}
                        </div>
                      </div>
                    </details>
                  )
                })}
              </div>
            </section>

            <section className="card dashboard-panel dashboard-orders-panel">
              <h3>Fila de devoluções e reembolsos</h3>
              {dashboard.returnsQueue.length ? (
                <div className="dashboard-table-wrap">
                  <table className="dashboard-orders-table">
                    <thead>
                      <tr><th>Encomenda</th><th>Cliente</th><th>Devolução</th><th>Motivo</th><th>Rastreio</th><th>Reembolso</th><th>Stock</th></tr>
                    </thead>
                    <tbody>
                      {dashboard.returnsQueue.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.id}</td>
                          <td>{entry.customerName}</td>
                          <td>{returnLabels[entry.status]}</td>
                          <td>{entry.reason || '—'}</td>
                          <td>{entry.carrier ? `${entry.carrier} · ${entry.trackingNumber || 'sem código'}` : '—'}</td>
                          <td>{entry.refundStatus === 'refunded' ? 'Concluído' : entry.refundStatus === 'pending' ? 'Em processamento' : '—'}</td>
                          <td>{entry.restockedAt ? 'Reposto' : entry.status === 'refunded' ? 'Por repor' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p>Não há devoluções registadas.</p>}
            </section>

            <section className="card dashboard-panel dashboard-orders-panel">
              <h3>Contas correntes de fornecedores</h3>
              <p>Os pagamentos são executados fora da plataforma. Regista a referência do comprovativo depois de efetuar cada transferência.</p>
              {dashboard.payoutsList.length ? (
                <div className="dashboard-table-wrap">
                  <table className="dashboard-orders-table">
                    <thead>
                      <tr><th>Fornecedor</th><th>Encomenda</th><th>Valor</th><th>Estado</th><th>Referência</th><th>Ação</th></tr>
                    </thead>
                    <tbody>
                      {dashboard.payoutsList.map((payout) => {
                        const nextStatus = payout.status === 'pending' ? 'paid' : payout.status === 'recovery_required' ? 'recovered' : null
                        return (
                          <tr key={payout.id}>
                            <td>{payout.sellerName}</td>
                            <td>{payout.orderId}</td>
                            <td>{payout.currency === 'AOA' ? formatAoa(payout.amount) : formatEuro(payout.amount)}</td>
                            <td>{payoutLabels[payout.status]}</td>
                            <td>{payout.transferReference || '—'}</td>
                            <td>
                              {nextStatus ? (
                                <div className="dashboard-payout-action">
                                  <input
                                    aria-label="Referência do comprovativo da transferência"
                                    placeholder="Referência do comprovativo"
                                    maxLength={120}
                                    value={payoutReferences[payout.id] || ''}
                                    onChange={(event) => setPayoutReferences((current) => ({
                                      ...current,
                                      [payout.id]: event.target.value
                                    }))}
                                  />
                                  <button
                                    type="button"
                                    className="secondary-button"
                                    disabled={savingOperationId === payout.id}
                                    onClick={() => runOperation(
                                      payout.id,
                                      `/admin/payouts/${encodeURIComponent(payout.id)}/settlement`,
                                      {
                                        method: 'PATCH',
                                        body: JSON.stringify({ transferReference: payoutReferences[payout.id] || '' })
                                      },
                                      nextStatus === 'paid' ? 'Pagamento ao fornecedor registado.' : 'Recuperação do repasse registada.'
                                    )}
                                  >{nextStatus === 'paid' ? 'Registar pagamento' : 'Confirmar recuperação'}</button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p>Não existem repasses de vendedores registados.</p>}
            </section>

            <p className="dashboard-disclaimer">
              Os estados de expedição e os comprovativos de pagamento são registos administrativos. A aplicação não integra transportadoras nem executa transferências bancárias; os reembolsos são submetidos ao Stripe.
            </p>
          </>
        ) : null}
      </section>

      <h2 className="admin-management-title">Gestão do catálogo</h2>
      <div className="admin-layout">
        <form className="card admin-form" onSubmit={handleSubmit}>
          <h3>{form.id ? 'Editar produto' : 'Adicionar produto'}</h3>
          <label>
            Nome
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            Categoria
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              <option value="camisetas">Camisetas</option>
              <option value="calcas">Calças</option>
              <option value="acessorios">Acessórios</option>
            </select>
          </label>
          <div className="form-grid two-columns">
            <label>
              Moeda do preço
              <select value={form.priceCurrency || 'EUR'} onChange={(event) => setForm({ ...form, priceCurrency: event.target.value })}>
                <option value="EUR">EUR</option>
                <option value="AOA">KZ</option>
              </select>
            </label>
            <label>
              Preço base ({form.priceCurrency === 'AOA' ? 'KZ' : 'EUR'})
              <input type="number" min="1" step={form.priceCurrency === 'AOA' ? '1' : '0.01'} value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) })} required />
            </label>
            <label>
              Preço antigo ({form.priceCurrency === 'AOA' ? 'KZ' : 'EUR'})
              <input type="number" min="0" step={form.priceCurrency === 'AOA' ? '1' : '0.01'} value={form.oldPrice} onChange={(event) => setForm({ ...form, oldPrice: Number(event.target.value) })} />
            </label>
            <label>
              Stock
              <input type="number" value={form.stock} onChange={(event) => setForm({ ...form, stock: Number(event.target.value) })} required />
            </label>
            <label>
              Imagem
              <input value={form.image} onChange={(event) => setForm({ ...form, image: event.target.value })} />
            </label>
          </div>
          <label>
            Descrição
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={form.featured} onChange={(event) => setForm({ ...form, featured: event.target.checked })} />
            Destacar em destaque
          </label>
          <input type="file" accept="image/*" onChange={handleUpload} />
          {uploadMessage ? <p className="error-message">{uploadMessage}</p> : null}
          <button type="submit" className="primary-button full-width">Guardar</button>
        </form>

        <div className="card admin-list">
          <h3>Produtos de vendedores à espera de aprovação</h3>
          {approvalError ? <p className="error-message" role="alert">{approvalError}</p> : null}
          {pendingProducts.length === 0 ? <p>Não há produtos pendentes.</p> : null}
          {pendingProducts.map((product) => (
            <div className="admin-item" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <span>{product.sellerName} · {formatAoa(product.price * 1.02)} (inclui intermediação)</span>
              </div>
              <button type="button" className="primary-button" onClick={async () => {
                setApprovalError('')
                try {
                  await onApproveProduct(product.id)
                } catch (error) {
                  setApprovalError(error.message || 'Não foi possível aprovar o produto.')
                }
              }}>
                Aprovar publicação
              </button>
            </div>
          ))}
        </div>

        <div className="card admin-list">
          <h3>Produtos</h3>
          {products.map((product) => (
            <div className="admin-item" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <span>{product.category} · {product.priceCurrency === 'AOA' ? 'KZ' : 'EUR'} · {product.sellerName || 'Loja'}</span>
              </div>
              <div className="admin-actions">
                <button type="button" className="secondary-button" onClick={() => setForm({ ...product })}>Editar</button>
                <button type="button" className="link-button danger" onClick={() => onDeleteProduct(product.id)}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SellerPage() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasPickupLocation, setHasPickupLocation] = useState(false)
  const [savingPickupLocation, setSavingPickupLocation] = useState(false)
  const [form, setForm] = useState({
    id: '',
    name: '',
    category: 'camisetas',
    price: '',
    image: '/image/roupas/t_shert.png',
    description: '',
    stock: 0
  })

  const loadProducts = async () => {
    const items = await apiFetch('/seller/products')
    setProducts(items)
  }

  useEffect(() => {
    let active = true
    apiFetch('/seller/products').then((items) => {
      if (active) setProducts(items)
    }).catch((loadError) => {
      if (active) setError(loadError.message || 'Não foi possível carregar os teus produtos.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    apiFetch('/seller/location').then(({ hasPickupLocation: configured }) => {
      if (active) setHasPickupLocation(configured)
    }).catch((loadError) => {
      if (active) setError(loadError.message || 'Não foi possível carregar a localização de recolha.')
    })
    return () => { active = false }
  }, [])

  const savePickupLocation = async () => {
    setError('')
    setSavingPickupLocation(true)
    try {
      const coordinates = await getCurrentCoordinates()
      const { hasPickupLocation: configured } = await apiFetch('/seller/location', {
        method: 'PUT',
        body: JSON.stringify(coordinates)
      })
      setHasPickupLocation(configured)
    } catch (locationError) {
      setError(locationError.message || 'Não foi possível guardar a localização de recolha.')
    } finally {
      setSavingPickupLocation(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const method = form.id ? 'PUT' : 'POST'
      const endpoint = form.id ? `/products/${form.id}` : '/products'
      await apiFetch(endpoint, {
        method,
        body: JSON.stringify({
          ...form,
          price: Number(form.price),
          priceCurrency: 'AOA',
          oldPrice: 0,
          stock: Number(form.stock),
          featured: true
        })
      })
      await loadProducts()
      setForm({
        id: '',
        name: '',
        category: 'camisetas',
        price: '',
        image: '/image/roupas/t_shert.png',
        description: '',
        stock: 0
      })
    } catch (saveError) {
      setError(saveError.message || 'Não foi possível guardar o produto.')
    }
  }

  const handleDelete = async (productId) => {
    setError('')
    try {
      await apiFetch(`/products/${productId}`, { method: 'DELETE' })
      setProducts((current) => current.filter((product) => product.id !== productId))
    } catch (deleteError) {
      setError(deleteError.message || 'Não foi possível eliminar o produto.')
    }
  }

  const handleUpload = async (event) => {
    const file = event.target.files[0]
    if (!file) return
    const formData = new FormData()
    formData.append('image', file)
    setError('')
    try {
      const { url } = await apiFetch('/admin/upload', { method: 'POST', headers: {}, body: formData })
      setForm((current) => ({ ...current, image: url }))
    } catch (uploadError) {
      setError(uploadError.message || 'Não foi possível carregar a imagem.')
    }
  }

  return (
    <div className="container admin-page">
      <div className="admin-header">
        <h1>Painel do vendedor</h1>
        <Link to="/mensagens" className="primary-button">Ver mensagens</Link>
      </div>
      <section className="card pickup-location-card">
        <h2>Localização de recolha</h2>
        <p>Guarda o ponto de recolha dos produtos. A localização é usada para calcular a distância por estrada e o custo de envio. As coordenadas são enviadas ao OpenRouteService ao calcular uma cotação.</p>
        <p role="status">{hasPickupLocation ? 'Localização de recolha configurada.' : 'Configura a localização antes de receber encomendas.'}</p>
        <button type="button" className="secondary-button" onClick={savePickupLocation} disabled={savingPickupLocation}>
          {savingPickupLocation
            ? 'A obter localização...'
            : hasPickupLocation ? 'Atualizar ponto de recolha' : 'Usar localização atual como ponto de recolha'}
        </button>
      </section>
      <div className="admin-layout">
        <form className="card admin-form" onSubmit={handleSubmit}>
          <h3>{form.id ? 'Editar produto' : 'Publicar produto'}</h3>
          <p>O produto será enviado ao administrador para aprovação antes de aparecer na loja.</p>
          <label>
            Nome
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={200} required />
          </label>
          <label>
            Categoria
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              <option value="camisetas">Camisetas</option>
              <option value="calcas">Calças</option>
              <option value="acessorios">Acessórios</option>
            </select>
          </label>
          <label>
            Preço base (KZ)
            <input type="number" min="1" step="1" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} required />
          </label>
          <p className="field-hint">
            Preço com custo de intermediação (2%): {formatAoa(Number(form.price || 0) + Math.round(Number(form.price || 0) * 0.02))}
          </p>
          <label>
            Stock
            <input type="number" min="0" step="1" value={form.stock} onChange={(event) => setForm({ ...form, stock: Number(event.target.value) })} required />
          </label>
          <label>
            Imagem
            <input value={form.image} onChange={(event) => setForm({ ...form, image: event.target.value })} required />
          </label>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleUpload} />
          <label>
            Descrição
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={5000} required />
          </label>
          {error ? <p className="error-message" role="alert">{error}</p> : null}
          <button type="submit" className="primary-button full-width">
            {form.id ? 'Guardar alterações' : 'Enviar para aprovação'}
          </button>
        </form>
        <div className="card admin-list">
          <h3>Os meus produtos</h3>
          {loading ? <p role="status">A carregar produtos...</p> : null}
          {!loading && products.length === 0 ? <p>Ainda não publicaste produtos.</p> : null}
          {products.map((product) => (
            <div className="admin-item" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <span>{formatAoa(product.price * 1.02)} · {product.approved ? 'Publicado' : 'A aguardar aprovação'}</span>
                {product.approved ? null : <span>Editar o produto volta a enviá-lo para aprovação.</span>}
              </div>
              <div className="admin-actions">
                <button type="button" className="secondary-button" onClick={() => setForm({
                  id: product.id,
                  name: product.name,
                  category: product.category,
                  price: String(product.price),
                  image: product.image,
                  description: product.description,
                  stock: product.stock
                })}>Editar</button>
                <button type="button" className="link-button danger" onClick={() => handleDelete(product.id)}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ConversationsPage({ conversations, loading, error, unreadConversationIds }) {
  const unreadIds = new Set(unreadConversationIds)
  return (
    <section className="container messages-page">
      <h1>Mensagens</h1>
      {loading ? <p role="status">A carregar conversas...</p> : null}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
      {!loading && !conversations.length ? <p className="empty-state">Ainda não tens conversas.</p> : null}
      <div className="conversation-list">
        {conversations.map((conversation) => (
          <Link className="card conversation-item" to={`/chat/${conversation.id}`} key={conversation.id}>
            <strong>
              {conversation.productName}
              {unreadIds.has(conversation.id) ? <span className="new-message-badge">Nova mensagem</span> : null}
            </strong>
            <span>Conversa com {conversation.otherName}</span>
            <span>{conversation.lastMessage || 'Ainda não há mensagens.'}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function ChatPage({ currentUser, onMessagesRead }) {
  const { conversationId } = useParams()
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let active = true
    let requestPending = false
    const loadMessages = async () => {
      if (requestPending) return
      requestPending = true
      try {
        const { messages: entries } = await apiFetch(`/chat/conversations/${conversationId}/messages`)
        if (active) {
          setMessages(entries)
          setError('')
          if (entries.length) onMessagesRead(conversationId, entries[entries.length - 1].id)
        }
      } catch (loadError) {
        if (active) setError(loadError.message || 'Não foi possível carregar esta conversa.')
      } finally {
        requestPending = false
      }
    }
    loadMessages()
    const timer = window.setInterval(loadMessages, 3000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [conversationId, onMessagesRead])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!body.trim() || sending) return
    setSending(true)
    setError('')
    try {
      const { message } = await apiFetch(`/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body })
      })
      setMessages((current) => [...current, message])
      setBody('')
    } catch (sendError) {
      setError(sendError.message || 'Não foi possível enviar a mensagem.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="container chat-page">
      <div className="chat-header">
        <h1>Conversa sobre o produto</h1>
        <Link to="/mensagens" className="text-link">Voltar às mensagens</Link>
      </div>
      <div className="card chat-messages" aria-live="polite">
        {messages.map((message) => (
          <article className={`chat-message${message.senderId === currentUser.id ? ' own-message' : ''}`} key={message.id}>
            <strong>{message.senderName}</strong>
            <p>{message.body}</p>
            <time dateTime={message.createdAt}>
              {new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(message.createdAt))}
            </time>
          </article>
        ))}
        {!messages.length ? <p>Ainda não há mensagens. Envia a primeira.</p> : null}
      </div>
      <form className="card chat-form" onSubmit={handleSubmit}>
        <label>
          Mensagem
          <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={3} required />
        </label>
        {error ? <p className="error-message" role="alert">{error}</p> : null}
        <button type="submit" className="primary-button" disabled={sending || !body.trim()}>
          {sending ? 'A enviar...' : 'Enviar mensagem'}
        </button>
      </form>
    </section>
  )
}

export default function App() {
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [pendingProducts, setPendingProducts] = useState([])
  const [productError, setProductError] = useState('')
  const [authError, setAuthError] = useState('')
  const [exchangeRate, setExchangeRate] = useState(null)
  const [exchangeRateUpdatedAt, setExchangeRateUpdatedAt] = useState('')
  const [exchangeRateError, setExchangeRateError] = useState('')
  const [reviews, setReviews] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [reviewsError, setReviewsError] = useState('')
  const [conversations, setConversations] = useState([])
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [conversationsError, setConversationsError] = useState('')
  const [unreadConversationIds, setUnreadConversationIds] = useState([])
  const hasSavedSession = Boolean(localStorage.getItem('shopco-token'))
  const [cartKey, setCartKey] = useState(() => hasSavedSession ? null : getCartStorageKey(null))
  const [cart, setCart] = useState(() => hasSavedSession
    ? []
    : getStoredValue(getCartStorageKey(null), []))
  const [currentUser, setCurrentUser] = useState(null)
  const [authChecking, setAuthChecking] = useState(hasSavedSession)

  useEffect(() => {
    let active = true
    apiFetch('/products').then((items) => {
      if (!active) return
      const normalized = normalizeProducts(items)
      setProducts(normalized)
      saveStoredValue('shopco-products', normalized)
      setProductError('')
    }).catch((error) => {
      if (!active) return
      const saved = getStoredValue('shopco-products', fallbackProducts)
      setProducts(normalizeProducts(saved))
      setProductError(`Não foi possível atualizar o catálogo (${error.message}). A mostrar dados guardados localmente.`)
    }).finally(() => {
      if (active) setProductsLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    let requestPending = false
    if (!currentUser || !['customer', 'seller'].includes(currentUser.role)) {
      setConversations([])
      setUnreadConversationIds([])
      setConversationsLoading(false)
      return () => { active = false }
    }

    setConversationsLoading(true)
    const loadConversations = async () => {
      if (requestPending) return
      requestPending = true
      try {
        const { conversations: entries } = await apiFetch('/chat/conversations')
        if (active) {
          setConversations(entries)
          setUnreadConversationIds(getUnreadConversationIds(
            entries,
            currentUser.id,
            getReadMessages(currentUser.id)
          ))
          setConversationsError('')
        }
      } catch (error) {
        if (active) setConversationsError(`Não foi possível carregar as mensagens: ${error.message}`)
      } finally {
        requestPending = false
        if (active) setConversationsLoading(false)
      }
    }
    loadConversations()
    const timer = window.setInterval(loadConversations, 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [currentUser])

  useEffect(() => {
    let active = true
    if (currentUser?.role !== 'admin') {
      setPendingProducts([])
      return () => { active = false }
    }
    apiFetch('/admin/products/pending').then((items) => {
      if (active) setPendingProducts(items)
    }).catch((error) => {
      if (active) setProductError(`Não foi possível carregar produtos pendentes: ${error.message}`)
    })
    return () => { active = false }
  }, [currentUser])

  useEffect(() => {
    let active = true
    apiFetch('/exchange-rate').then((data) => {
      if (!Number.isFinite(Number(data?.rate)) || Number(data.rate) <= 0) {
        throw new Error('A API devolveu uma cotação inválida.')
      }
      if (!active) return
      setExchangeRate(Number(data.rate))
      setExchangeRateUpdatedAt(data.updatedAt || '')
      setExchangeRateError(data.isFallback
        ? 'O serviço de câmbio está indisponível. Os preços usam uma cotação de referência que pode estar desatualizada.'
        : '')
    }).catch((error) => {
      if (active) setExchangeRateError(`Não foi possível carregar a cotação EUR/AOA: ${error.message}`)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    apiFetch('/reviews').then(({ reviews: entries }) => {
      if (active) setReviews(entries)
    }).catch((error) => {
      if (active) setReviewsError(`Não foi possível carregar os comentários: ${error.message}`)
    }).finally(() => {
      if (active) setReviewsLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    if (!localStorage.getItem('shopco-token')) {
      setAuthChecking(false)
      return () => { active = false }
    }

    apiFetch('/auth/me').then(({ user }) => {
      if (active) {
        setCurrentUser(user)
        const key = getCartStorageKey(user.id)
        setCartKey(key)
        setCart(getStoredValue(key, []))
      }
    }).catch((error) => {
      if (!active) return
      if (error.status === 401 || error.status === 404) {
        localStorage.removeItem('shopco-token')
        const key = getCartStorageKey(null)
        setCartKey(key)
        setCart(getStoredValue(key, []))
      } else {
        setAuthError(`Não foi possível validar a sessão: ${error.message}`)
      }
    }).finally(() => {
      if (active) setAuthChecking(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    localStorage.removeItem('shopco-cart')
  }, [])

  useEffect(() => {
    if (cartKey) saveStoredValue(cartKey, cart)
  }, [cart, cartKey])

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart])

  const loadCartForUser = (user) => {
    const key = getCartStorageKey(user?.id ?? null)
    setCartKey(key)
    setCart(getStoredValue(key, []))
  }

  const addToCart = (product) => {
    if (!cartKey) return
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id)
      if (Number(product.stock) <= (existing?.quantity || 0)) return prev
      if (existing) {
        return prev.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item))
      }
      return [...prev, { id: product.id, quantity: 1 }]
    })
  }

  const updateQuantity = (productId, delta) => {
    if (!cartKey) return
    const stock = Number(products.find((product) => product.id === productId)?.stock || 0)
    setCart((prev) => prev.map((item) => {
      if (item.id !== productId) return item
      const quantity = Math.min(stock, item.quantity + delta)
      return { ...item, quantity }
    }).filter((item) => item.quantity > 0))
  }

  const removeItem = (productId) => {
    if (!cartKey) return
    setCart((prev) => prev.filter((item) => item.id !== productId))
  }

  const handleMessagesRead = useCallback((conversationId, messageId) => {
    if (!currentUser) return
    markConversationRead(currentUser.id, conversationId, messageId)
    setUnreadConversationIds((ids) => ids.filter((id) => id !== conversationId))
  }, [currentUser])

  const createCheckout = async (payload) => {
    const response = await apiFetch('/payments/create-checkout-session', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
    if (!response.url) throw new Error('O Stripe não devolveu um endereço de pagamento.')
    const checkoutUrl = new URL(response.url)
    if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
      throw new Error('O Stripe devolveu um endereço de pagamento inválido.')
    }
    return { ...response, url: checkoutUrl.toString() }
  }

  const confirmPayment = async (sessionId) => {
    const order = await apiFetch('/payments/confirm', {
      method: 'POST',
      body: JSON.stringify({ sessionId })
    })
    setCart([])
    try {
      const freshProducts = normalizeProducts(await apiFetch('/products'))
      setProducts(freshProducts)
      saveStoredValue('shopco-products', freshProducts)
    } catch (error) {
      setProductError(`Pagamento confirmado, mas não foi possível atualizar o catálogo: ${error.message}`)
    }
    return order
  }

  const loginUser = async (email, password) => {
    const response = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    })
    localStorage.setItem('shopco-token', response.token)
    loadCartForUser(response.user)
    setCurrentUser(response.user)
    return response.user
  }

  const updateProfileImage = async (file) => {
    const formData = new FormData()
    formData.append('image', file)
    const response = await apiFetch('/auth/profile-image', {
      method: 'PATCH',
      body: formData
    })
    setCurrentUser(response.user)
    return response
  }

  const registerUser = async (form) => {
    const response = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify(form)
    })
    localStorage.setItem('shopco-token', response.token)
    loadCartForUser(response.user)
    setCurrentUser(response.user)
    return response.user
  }

  const logoutUser = () => {
    localStorage.removeItem('shopco-token')
    loadCartForUser(null)
    setCurrentUser(null)
    setAuthChecking(false)
  }

  const saveProduct = async (productData) => {
    const method = productData.id ? 'PUT' : 'POST'
    const endpoint = productData.id ? `/products/${productData.id}` : '/products'
    const payload = { ...productData, price: Number(productData.price), oldPrice: Number(productData.oldPrice || 0), stock: Number(productData.stock || 0), featured: Boolean(productData.featured) }
    const response = await apiFetch(endpoint, { method, body: JSON.stringify(payload) })
    setProducts((prev) => {
      const next = prev.some((item) => item.id === response.id)
        ? prev.map((item) => (item.id === response.id ? response : item))
        : [response, ...prev]
      saveStoredValue('shopco-products', next)
      return next
    })
    return response
  }

  const deleteProduct = async (productId) => {
    await apiFetch(`/products/${productId}`, { method: 'DELETE' })
    setProducts((prev) => prev.filter((item) => item.id !== productId))
  }

  const createReview = async (comment) => {
    const { review } = await apiFetch('/reviews', {
      method: 'POST',
      body: JSON.stringify({ comment })
    })
    setReviews((previous) => [review, ...previous])
    return review
  }

  const startChat = async (productId) => {
    const { conversationId } = await apiFetch('/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ productId })
    })
    return conversationId
  }

  const approveSellerProduct = async (productId) => {
    await apiFetch(`/admin/products/${productId}/approval`, {
      method: 'PATCH',
      body: JSON.stringify({ approved: true })
    })
    setPendingProducts((current) => current.filter((product) => product.id !== productId))
    const freshProducts = normalizeProducts(await apiFetch('/products'))
    setProducts(freshProducts)
    saveStoredValue('shopco-products', freshProducts)
  }

  const isAdmin = currentUser?.role === 'admin'
  const isSeller = currentUser?.role === 'seller'

  return (
    <div className="app-shell">
      <Navbar cartCount={cartCount} currentUser={currentUser} unreadMessageCount={unreadConversationIds.length} />
      <main>
        {productError ? <p className="container status-message" role="status">{productError}</p> : null}
        {authError ? <p className="container status-message" role="status">{authError}</p> : null}
        {exchangeRateError ? <p className="container status-message" role="alert">{exchangeRateError}</p> : null}
        {reviewsError ? <p className="container status-message" role="alert">{reviewsError}</p> : null}
        {conversationsError ? <p className="container status-message" role="alert">{conversationsError}</p> : null}
        <Routes>
          <Route path="/" element={<HomePage products={products} productsLoading={productsLoading} exchangeRate={exchangeRate} exchangeRateUpdatedAt={exchangeRateUpdatedAt} reviews={reviews} reviewsLoading={reviewsLoading} currentUser={currentUser} authChecking={authChecking} onCreateReview={createReview} onAddToCart={addToCart} />} />
          <Route path="/produto/:id" element={<ProductPage products={products} productsLoading={productsLoading} exchangeRate={exchangeRate} currentUser={currentUser} onStartChat={startChat} onAddToCart={addToCart} />} />
          <Route path="/carrinho" element={<CartPage cart={cart} products={products} productsLoading={productsLoading} exchangeRate={exchangeRate} onUpdateQuantity={updateQuantity} onRemoveItem={removeItem} />} />
          <Route path="/checkout" element={<CheckoutPage cart={cart} products={products} productsLoading={productsLoading} currentUser={currentUser} authChecking={authChecking} exchangeRate={exchangeRate} onCreateCheckout={createCheckout} />} />
          <Route path="/checkout/sucesso" element={<SuccessPage currentUser={currentUser} authChecking={authChecking} exchangeRate={exchangeRate} onConfirmPayment={confirmPayment} />} />
          <Route path="/login" element={<LoginPage currentUser={currentUser} onLogin={loginUser} onLogout={logoutUser} onUpdateProfileImage={updateProfileImage} />} />
              <Route path="/registo" element={<RegisterPage onRegister={registerUser} />} />
          <Route path="/mensagens" element={currentUser && currentUser.role !== 'admin' ? <ConversationsPage conversations={conversations} loading={conversationsLoading} error={conversationsError} unreadConversationIds={unreadConversationIds} /> : <div className="container empty-state">Inicia sessão como cliente ou vendedor para ver as mensagens. <Link to="/login" className="text-link">Entrar</Link></div>} />
          <Route path="/chat/:conversationId" element={currentUser && currentUser.role !== 'admin' ? <ChatPage currentUser={currentUser} onMessagesRead={handleMessagesRead} /> : <div className="container empty-state">Inicia sessão para aceder à conversa. <Link to="/login" className="text-link">Entrar</Link></div>} />
          <Route path="/vendedor" element={isSeller ? <SellerPage /> : <div className="container empty-state">Acesso reservado a vendedores. <Link to="/login" className="text-link">Entrar</Link></div>} />
          <Route
            path="/admin"
            element={
              isAdmin ? (
                <AdminPage products={products} pendingProducts={pendingProducts} onApproveProduct={approveSellerProduct} onSaveProduct={saveProduct} onDeleteProduct={deleteProduct} onLogout={logoutUser} />
              ) : (
                <div className="container empty-state">Acesso restrito. <Link to="/login" className="text-link">Faz login como administrador</Link></div>
              )
            }
          />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
