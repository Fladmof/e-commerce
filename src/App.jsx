import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'

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

const formatPrice = (value) =>
  new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(Number(value || 0))
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

function Navbar({ cartCount, currentUser }) {
  return (
    <header className="header">
      <div className="container nav-wrap">
        <Link to="/" className="brand">SHOP.CO</Link>
        <nav className="main-nav">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/#catalogo">Catálogo</NavLink>
          <NavLink to="/checkout">Checkout</NavLink>
          <NavLink to="/admin">Admin</NavLink>
        </nav>
        <div className="nav-actions">
          <Link to="/login" className="nav-link">
            {currentUser ? currentUser.name : 'Entrar'}
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

function ProductCard({ product, onAddToCart }) {
  const discount = product.oldPrice ? Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100) : 0

  return (
    <article className="product-card">
      <Link to={`/produto/${product.id}`} className="product-image-wrap">
        <img src={getImageUrl(product.image)} alt={product.name} className="product-image" />
      </Link>
      <div className="product-info">
        <div>
          <h3>{product.name}</h3>
          <p className="product-rating">⭐ {product.rating}/5</p>
        </div>
        <div className="product-price-row">
          <span className="current-price">{formatPrice(product.price)}</span>
          {product.oldPrice ? <span className="old-price">{formatPrice(product.oldPrice)}</span> : null}
          {discount ? <span className="discount-badge">-{discount}%</span> : null}
        </div>
        <p className="product-description">{product.description}</p>
        <button type="button" className="primary-button" onClick={() => onAddToCart(product)} disabled={product.stock <= 0}>
          {product.stock <= 0 ? 'Sem stock' : 'Adicionar ao carrinho'}
        </button>
      </div>
    </article>
  )
}

function HomePage({ products, onAddToCart, productsLoading }) {
  const [search, setSearch] = useState('')
  const featured = products.filter((product) => product.featured)
  const matchingProducts = products.filter((product) =>
    `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(search.trim().toLowerCase())
  )
  const visibleProducts = search.trim() ? matchingProducts : featured

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
          <h2>{search.trim() ? 'Resultados da pesquisa' : 'Produtos em destaque'}</h2>
          <Link to="/checkout" className="text-link">Ir para checkout</Link>
        </div>
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
            <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />
          ))}
        </div>
        )}
        {productsLoading ? <p role="status">A carregar produtos...</p> : null}
        {!productsLoading && visibleProducts.length === 0 ? <p className="empty-state">Não foram encontrados produtos.</p> : null}
      </section>
    </>
  )
}

function ProductPage({ products, onAddToCart, productsLoading }) {
  const { id } = useParams()
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
        <p className="product-rating">⭐ {product.rating}/5</p>
        <div className="product-price-row large">
          <span className="current-price">{formatPrice(product.price)}</span>
          {product.oldPrice ? <span className="old-price">{formatPrice(product.oldPrice)}</span> : null}
          {discount ? <span className="discount-badge">-{discount}%</span> : null}
        </div>
        <p className="detail-description">{product.description}</p>
        <div className="detail-meta">
          <span>Disponibilidade: {product.stock} em stock</span>
          <span>Entrega: 2-4 dias</span>
        </div>
        <button type="button" className="primary-button large" onClick={() => onAddToCart(product)} disabled={product.stock <= 0}>
          {product.stock <= 0 ? 'Sem stock' : 'Adicionar ao carrinho'}
        </button>
      </div>
    </div>
  )
}

function CartPage({ cart, products, productsLoading, onUpdateQuantity, onRemoveItem }) {
  const cartItems = cart
    .map((item) => {
      const product = products.find((entry) => entry.id === item.id)
      if (!product) return null
      return { ...product, quantity: item.quantity }
    })
    .filter(Boolean)

  const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)

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
                  <p>{formatPrice(item.price)}</p>
                  <div className="quantity-controls">
                    <button type="button" onClick={() => onUpdateQuantity(item.id, -1)}>-</button>
                    <span>{item.quantity}</span>
                    <button type="button" onClick={() => onUpdateQuantity(item.id, 1)} disabled={item.quantity >= item.stock} aria-label={`Aumentar quantidade de ${item.name}`}>+</button>
                  </div>
                </div>
                <div className="cart-item-actions">
                  <strong>{formatPrice(item.price * item.quantity)}</strong>
                  <button type="button" className="link-button" onClick={() => onRemoveItem(item.id)}>Remover</button>
                </div>
              </div>
            ))}
          </div>

          <aside className="summary-card">
            <h3>Resumo</h3>
            <div className="summary-row"><span>Subtotal</span><strong>{formatPrice(total)}</strong></div>
            <div className="summary-row"><span>Envio</span><strong>{formatPrice(total > 0 ? 15 : 0)}</strong></div>
            <div className="summary-row total"><span>Total</span><strong>{formatPrice(total > 0 ? total + 15 : 0)}</strong></div>
            <Link to="/checkout" className="primary-button full-width">Finalizar compra</Link>
          </aside>
        </div>
      )}
    </div>
  )
}

function CheckoutPage({ cart, products, productsLoading, currentUser, authChecking, onCreateCheckout }) {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const location = useLocation()
  const cartItems = cart
    .map((item) => {
      const product = products.find((entry) => entry.id === item.id)
      if (!product) return null
      return { ...product, quantity: item.quantity }
    })
    .filter(Boolean)

  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const shipping = subtotal > 0 ? 15 : 0

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!cartItems.length || !currentUser || submitting) return

    setSubmitting(true)
    setError('')
    try {
      const { url } = await onCreateCheckout({
        items: cartItems.map((item) => ({ id: item.id, quantity: item.quantity }))
      })
      window.location.assign(url)
    } catch (error) {
      setError(error.message || 'Não foi possível iniciar o pagamento.')
      setSubmitting(false)
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

  return (
    <div className="container checkout-page">
      <h1>Checkout</h1>
      <form className="checkout-layout" onSubmit={handleSubmit}>
        <section className="checkout-form card">
          <h2>Pagamento seguro</h2>
          <p>O pagamento e os dados de entrega são recolhidos de forma segura pelo Stripe. Os dados do cartão não passam por esta loja.</p>
          <p>Conta: <strong>{currentUser.email}</strong></p>
          {error ? <p className="error-message" role="alert">{error}</p> : null}
          {error && sessionId && currentUser ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                attemptedSession.current = ''
                setError('')
                setRetry((value) => value + 1)
              }}
            >
              Tentar novamente
            </button>
          ) : null}
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
              <span>{formatPrice(item.price * item.quantity)}</span>
            </div>
          ))}
          <div className="summary-row"><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
          <div className="summary-row"><span>Envio</span><strong>{formatPrice(shipping)}</strong></div>
          <div className="summary-row total"><span>Total</span><strong>{formatPrice(subtotal + shipping)}</strong></div>
          <button type="submit" className="primary-button full-width" disabled={submitting}>
            {submitting ? 'A redirecionar...' : 'Continuar para pagamento'}
          </button>
        </aside>
      </form>
    </div>
  )
}

function SuccessPage({ currentUser, authChecking, onConfirmPayment }) {
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
            <p>Encomenda {order.id} recebida. Total pago: {formatPrice(order.total)}.</p>
          </>
        ) : null}
        {error ? <p className="error-message" role="alert">{error}</p> : null}
        <Link to="/" className="primary-button">Voltar à loja</Link>
      </div>
    </div>
  )
}

function LoginPage({ currentUser, onLogin, onLogout }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const requestedPath = new URLSearchParams(location.search).get('next')
  const destination = requestedPath?.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/'

  const handleSubmit = async (event) => {
    event.preventDefault()
    try {
      await onLogin(email, password)
      navigate(destination, { replace: true })
    } catch (e) {
      setError(e.message || 'Erro ao iniciar sessão')
    }
  }

  if (currentUser) {
    return (
      <div className="container auth-panel">
        <div className="card auth-card">
          <h1>Bem-vindo</h1>
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
        {import.meta.env.DEV ? <div className="demo-accounts">
          <span>Demo admin: admin@shopco.com / admin123</span>
          <span>Demo cliente: cliente@shopco.com / cliente123</span>
        </div> : null}
      </form>
    </div>
  )
}

function RegisterPage({ onRegister }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onRegister(form)
      navigate('/checkout', { replace: true })
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
function AdminPage({ products, onSaveProduct, onDeleteProduct, onLogout }) {
  const [form, setForm] = useState({
    id: '',
    name: '',
    category: 'camisetas',
    price: 0,
    oldPrice: 0,
    image: '/image/roupas/t_shert.png',
    description: '',
    stock: 0,
    featured: false
  })
  const [uploadMessage, setUploadMessage] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    try {
      await onSaveProduct(form)
      setForm({
        id: '',
        name: '',
        category: 'camisetas',
        price: 0,
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
        <button type="button" className="secondary-button" onClick={onLogout}>Sair</button>
      </div>

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
              Preço
              <input type="number" value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) })} required />
            </label>
            <label>
              Preço antigo
              <input type="number" value={form.oldPrice} onChange={(event) => setForm({ ...form, oldPrice: Number(event.target.value) })} />
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
          <h3>Produtos</h3>
          {products.map((product) => (
            <div className="admin-item" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <span>{product.category}</span>
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

export default function App() {
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productError, setProductError] = useState('')
  const [authError, setAuthError] = useState('')
  const [cart, setCart] = useState(() => getStoredValue('shopco-cart', []))
  const [currentUser, setCurrentUser] = useState(null)
  const [authChecking, setAuthChecking] = useState(() => Boolean(localStorage.getItem('shopco-token')))

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
    if (!localStorage.getItem('shopco-token')) {
      setAuthChecking(false)
      return () => { active = false }
    }

    apiFetch('/auth/me').then(({ user }) => {
      if (active) setCurrentUser(user)
    }).catch((error) => {
      if (!active) return
      if (error.status === 401 || error.status === 404) {
        localStorage.removeItem('shopco-token')
      } else {
        setAuthError(`Não foi possível validar a sessão: ${error.message}`)
      }
    }).finally(() => {
      if (active) setAuthChecking(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    saveStoredValue('shopco-cart', cart)
  }, [cart])

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart])

  const addToCart = (product) => {
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
    const stock = Number(products.find((product) => product.id === productId)?.stock || 0)
    setCart((prev) => prev.map((item) => {
      if (item.id !== productId) return item
      const quantity = Math.min(stock, item.quantity + delta)
      return { ...item, quantity }
    }).filter((item) => item.quantity > 0))
  }

  const removeItem = (productId) => {
    setCart((prev) => prev.filter((item) => item.id !== productId))
  }

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
    setCurrentUser(response.user)
    return response.user
  }

  const registerUser = async (form) => {
    const response = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify(form)
    })
    localStorage.setItem('shopco-token', response.token)
    setCurrentUser(response.user)
    return response.user
  }

  const logoutUser = () => {
    localStorage.removeItem('shopco-token')
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

  const isAdmin = currentUser?.role === 'admin'

  return (
    <div className="app-shell">
      <Navbar cartCount={cartCount} currentUser={currentUser} />
      <main>
        {productError ? <p className="container status-message" role="status">{productError}</p> : null}
        {authError ? <p className="container status-message" role="status">{authError}</p> : null}
        <Routes>
          <Route path="/" element={<HomePage products={products} productsLoading={productsLoading} onAddToCart={addToCart} />} />
          <Route path="/produto/:id" element={<ProductPage products={products} productsLoading={productsLoading} onAddToCart={addToCart} />} />
          <Route path="/carrinho" element={<CartPage cart={cart} products={products} productsLoading={productsLoading} onUpdateQuantity={updateQuantity} onRemoveItem={removeItem} />} />
          <Route path="/checkout" element={<CheckoutPage cart={cart} products={products} productsLoading={productsLoading} currentUser={currentUser} authChecking={authChecking} onCreateCheckout={createCheckout} />} />
          <Route path="/checkout/sucesso" element={<SuccessPage currentUser={currentUser} authChecking={authChecking} onConfirmPayment={confirmPayment} />} />
          <Route path="/login" element={<LoginPage currentUser={currentUser} onLogin={loginUser} onLogout={logoutUser} />} />
          <Route path="/registo" element={<RegisterPage onRegister={registerUser} />} />
          <Route
            path="/admin"
            element={
              isAdmin ? (
                <AdminPage products={products} onSaveProduct={saveProduct} onDeleteProduct={deleteProduct} onLogout={logoutUser} />
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
