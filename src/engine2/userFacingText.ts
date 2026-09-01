const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()

export const toDirectPolishDisplayText = (value: unknown) => {
  const text = normalize(value)
  const replacements: Array<[RegExp, string]> = [
    [/^użytkownik\s+chce,?\s+aby\s+/i, 'Chcesz, aby '],
    [/^użytkownik\s+chce,?\s+żeby\s+/i, 'Chcesz, żeby '],
    [/^użytkownik\s+nie\s+chce,?\s+aby\s+/i, 'Nie chcesz, aby '],
    [/^użytkownik\s+nie\s+chce,?\s+żeby\s+/i, 'Nie chcesz, żeby '],
    [/^użytkownik\s+nie\s+chce\s+/i, 'Nie chcesz '],
    [/^użytkownik\s+chce\s+/i, 'Chcesz '],
    [/^użytkownik\s+chciałby\s+/i, 'Chcesz '],
    [/^użytkownik\s+chciałaby\s+/i, 'Chcesz '],
    [/^użytkownik\s+potrzebuje\s+/i, 'Potrzebujesz '],
    [/^użytkownik\s+oczekuje\s+/i, 'Oczekujesz '],
    [/^użytkownik\s+musi\s+/i, 'Musisz '],
    [/^użytkownik\s+ma\s+/i, 'Masz '],
    [/^użytkownikowi\s+zależy\s+na\s+/i, 'Zależy Ci na '],
    [/^użytkownik\s+preferuje\s+/i, 'Preferujesz '],
    [/^użytkownik\s+potwierdził,?\s+że\s+/i, 'Potwierdzasz, że '],
    [/^użytkownik\s+potwierdza,?\s+że\s+/i, 'Potwierdzasz, że '],
    [/^użytkownik\s+wskazał,?\s+że\s+/i, 'Wskazujesz, że '],
    [/^użytkownik\s+wskazuje,?\s+że\s+/i, 'Wskazujesz, że '],
    [/^użytkownik\s+wybrał\s+/i, 'Wybierasz '],
    [/^użytkownik\s+wybiera\s+/i, 'Wybierasz '],
    [/^użytkownik\s+proponuje\s+/i, 'Proponujesz '],
  ]
  let direct = text
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(direct)) {
      direct = direct.replace(pattern, replacement)
      break
    }
  }
  return direct
    .replace(/\bgdzie\s+go\s+potrzebuje\b/gi, 'gdzie ich potrzebujesz')
    .replace(/\bgdzie\s+go\s+potrzebujesz\b/gi, 'gdzie ich potrzebujesz')
    .replace(/\bgdzie\s+ich\s+potrzebuje\b/gi, 'gdzie ich potrzebujesz')
    .replace(/\bktórego\s+potrzebuje\b/gi, 'którego potrzebujesz')
}
