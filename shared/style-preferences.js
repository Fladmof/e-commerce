export const stylePreferenceOptions = {
  categories: [
    { value: 'camisetas', label: 'Camisetas' },
    { value: 'calcas', label: 'Calças' },
    { value: 'acessorios', label: 'Acessórios' }
  ],
  styles: [
    { value: 'casual', label: 'Casual' },
    { value: 'elegante', label: 'Elegante' },
    { value: 'streetwear', label: 'Streetwear' },
    { value: 'desportivo', label: 'Desportivo' }
  ],
  colors: [
    { value: 'preto', label: 'Preto' },
    { value: 'branco', label: 'Branco' },
    { value: 'azul', label: 'Azul' },
    { value: 'neutros', label: 'Tons neutros' }
  ]
}

export const emptyStylePreferences = {
  categories: [],
  styles: [],
  colors: [],
  budget: 'any'
}

const budgets = new Set(['any', 'under-50', '50-100', 'over-100'])

export function normalizeStylePreferences(value) {
  if (value === undefined || value === null) return { ...emptyStylePreferences }
  if (typeof value !== 'object' || Array.isArray(value)) return null

  const preferences = {}
  for (const group of Object.keys(stylePreferenceOptions)) {
    const selected = value[group] ?? []
    const allowed = new Set(stylePreferenceOptions[group].map((option) => option.value))
    if (
      !Array.isArray(selected) ||
      selected.length > allowed.size ||
      selected.some((option) => typeof option !== 'string' || !allowed.has(option))
    ) {
      return null
    }
    preferences[group] = [...new Set(selected)]
  }

  const budget = value.budget ?? 'any'
  if (typeof budget !== 'string' || !budgets.has(budget)) return null
  preferences.budget = budget
  return preferences
}

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()

const styleTerms = {
  casual: ['casual', 'diario', 'basico', 'basica'],
  elegante: ['elegante', 'sofisticado', 'formal', 'classico'],
  streetwear: ['streetwear', 'urbano', 'oversized'],
  desportivo: ['desportivo', 'sport', 'treino']
}

const colorTerms = {
  preto: ['preto', 'preta', 'pretos', 'pretas'],
  branco: ['branco', 'branca', 'brancos', 'brancas'],
  azul: ['azul'],
  neutros: ['neutro', 'neutra', 'bege', 'cinzento', 'cinza']
}

export function scoreStylePreference(product, value, priceInEur) {
  const preferences = normalizeStylePreferences(value)
  if (!preferences) return 0

  const text = normalizeText(`${product.name} ${product.category} ${product.description}`)
  let score = preferences.categories.includes(product.category) ? 4 : 0

  for (const style of preferences.styles) {
    if (styleTerms[style].some((term) => text.includes(term))) score += 2
  }
  for (const color of preferences.colors) {
    if (colorTerms[color].some((term) => text.includes(term))) score += 1
  }

  if (preferences.budget !== 'any' && Number.isFinite(priceInEur)) {
    const matchesBudget = preferences.budget === 'under-50'
      ? priceInEur < 50
      : preferences.budget === '50-100'
        ? priceInEur >= 50 && priceInEur <= 100
        : priceInEur > 100
    if (matchesBudget) score += 1
  }

  return score
}
