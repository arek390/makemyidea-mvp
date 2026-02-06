export const buildNameFallbacks = (description, count = 5) => {
  const fallbackNameSeeds = ['Nova', 'Pulse', 'Craft', 'Shift', 'Spark', 'Flow', 'Nest']
  const words = String(description || '')
    .toLowerCase()
    .replace(/[^a-z0-9ąćęłńóśżź\s-]/gi, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4)
  const unique = [...new Set(words)]
  const base = unique.length ? unique.slice(0, count) : fallbackNameSeeds
  const names = []
  base.forEach((word, index) => {
    const cap = word.charAt(0).toUpperCase() + word.slice(1)
    names.push(cap)
    if (names.length < count) names.push(`${cap} Lab`)
    if (names.length < count) names.push(`${cap} Hub`)
    if (names.length < count && fallbackNameSeeds[index]) names.push(`${cap} ${fallbackNameSeeds[index]}`)
  })
  return names.slice(0, count)
}

export const buildIdeaFallbacks = (cells, ideasPerCell = 3) => {
  const ideas = {}
  cells.forEach((cell) => {
    const list = []
    for (let i = 0; i < ideasPerCell; i += 1) {
      list.push(`Idea for ${cell.spaceDef} (${cell.timeDef})`)
    }
    ideas[cell.id] = list
  })
  return ideas
}

export const buildSpaceFallbacks = (productName) => {
  const base = String(productName || 'Product').trim() || 'Product'
  return {
    worldOptions: [
      `${base} usage`,
      `${base} market`,
      `${base} ecosystem`,
      'Home',
      'Workplace',
      'Public space',
      'Retail',
      'Logistics',
      'Healthcare',
      'Education',
    ],
    elementOptions: [
      'Core module',
      'Housing',
      'Materials',
      'Sensors',
      'Power unit',
      'Interface layer',
      'Connectivity',
      'Packaging',
      'Fasteners',
      'Support parts',
    ],
  }
}

export const buildTimeFallbacks = () => [
  'Past constraints',
  'Current state',
  'Future trends',
  'Existing workflow',
  'Pain points',
  'Desired outcome',
  'Market evolution',
  'Technology shift',
  'User habits',
  'Regulation changes',
  'Lifecycle stage',
  'Maintenance phase',
  'Scaling stage',
  'Adoption barriers',
  'Optimization phase',
]

export const buildQuestionFallbacks = ({ productName, spaceDef, timeDef, count = 10 }) => {
  const base = `What matters for ${productName} in ${spaceDef} at ${timeDef}?`
  return Array.from({ length: Math.min(count, 10) }, () => base)
}
