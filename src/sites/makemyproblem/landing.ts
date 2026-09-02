import type { HtmlPublicPageDefinition } from '../publicPages'
import { siteConfigs } from '../siteConfig'

type LandingLang = 'en' | 'pl' | 'de'

type LandingContent = {
  lang: LandingLang
  pathname: `/${LandingLang}`
  title: string
  description: string
  nav: {
    home: string
    howItWorks: string
    examples: string
    pricing: string
    about: string
    login: string
  }
  hero: {
    eyebrow: string
    title: string
    copy: string
    cta: string
    reassurance: string
    aside: string
  }
  how: {
    title: string
    steps: readonly { title: string; body: string }[]
  }
  conversation: {
    title: string
    cards: readonly string[]
  }
  examples: {
    title: string
    items: readonly { title: string; body: string }[]
  }
  finalCta: {
    title: string
    body: string
    cta: string
  }
  footer: {
    tagline: string
    disclaimer: string
    copyright: string
  }
}

const makeMyProblemSite = siteConfigs.makeMyProblem

const alternateLinks = [
  { hreflang: 'en', href: `${makeMyProblemSite.canonicalUrl}/en` },
  { hreflang: 'pl', href: `${makeMyProblemSite.canonicalUrl}/pl` },
  { hreflang: 'de', href: `${makeMyProblemSite.canonicalUrl}/de` },
  { hreflang: 'x-default', href: `${makeMyProblemSite.canonicalUrl}/en` },
] as const

// Edit localized landing copy here. PL and DE are working translations pending final copy review.
const landingContent: readonly LandingContent[] = [
  {
    lang: 'en',
    pathname: '/en',
    title: 'MakeMyProblem.Work - AI problem solving with an action plan',
    description:
      'MakeMyProblem.Work helps you clarify a problem through a short AI-guided conversation and turn it into focused next actions.',
    nav: {
      home: 'Home',
      howItWorks: 'How It Works',
      examples: 'Examples',
      pricing: 'Pricing',
      about: 'About',
      login: 'Login',
    },
    hero: {
      eyebrow: 'AI problem solving',
      title: 'From problem to action plan',
      copy:
        'MakeMyProblem.Work helps you clarify a problem through a short AI-guided conversation, organize what matters and move toward concrete next actions.',
      cta: 'Start solving',
      reassurance: 'Short conversation. No long briefing required.',
      aside:
        'Built for moments when the situation is unclear, the tradeoffs are real and you need a practical way forward instead of a long generic answer.',
    },
    how: {
      title: 'How it works',
      steps: [
        { title: 'Describe the problem', body: 'Start with what you know, even if it is messy or incomplete.' },
        { title: 'Clarify what matters', body: 'The AI asks focused questions and helps surface missing information.' },
        { title: 'Get an actionable plan', body: 'Turn the conversation into structured next actions you can use.' },
      ],
    },
    conversation: {
      title: 'What the conversation does',
      cards: [
        'It asks focused questions instead of producing a generic answer too early.',
        'It looks for missing information, unclear assumptions and conflicting requirements.',
        'It structures what is already known so the real decision becomes easier to see.',
        'It leads toward concrete next actions for structured problem solving.',
      ],
    },
    examples: {
      title: 'Problems it can help with',
      items: [
        { title: 'Technical or product issue', body: 'Clarify symptoms, constraints and likely next checks.' },
        { title: 'Project or process blocker', body: 'Separate facts, assumptions and coordination gaps.' },
        { title: 'Decision with tradeoffs', body: 'Compare conflicting requirements before choosing a path.' },
        { title: 'Unclear root cause', body: 'Map what is known before jumping to a solution.' },
      ],
    },
    finalCta: {
      title: 'Start with the problem you have now',
      body:
        'A few focused answers are enough to begin. MakeMyProblem.Work will help you clarify the situation and shape a practical action plan.',
      cta: 'Start solving',
    },
    footer: {
      tagline: 'AI-assisted web apps for problem solving.',
      disclaimer: 'AI-generated outputs require independent validation and are not production approval.',
      copyright: '© 2026 MakeMyProblemWork All rights reserved.',
    },
  },
  {
    lang: 'pl',
    pathname: '/pl',
    title: 'MakeMyProblem.Work - Rozwiązywanie problemów z AI i planem działania',
    description:
      'MakeMyProblem.Work pomaga doprecyzować problem w krótkiej rozmowie wspieranej przez AI i zamienić go w konkretne kolejne działania.',
    nav: {
      home: 'Start',
      howItWorks: 'Jak to działa',
      examples: 'Przykłady',
      pricing: 'Cennik',
      about: 'O nas',
      login: 'Login',
    },
    hero: {
      eyebrow: 'Rozwiązywanie problemów z AI',
      title: 'Od problemu do planu działania',
      copy:
        'MakeMyProblem.Work pomaga doprecyzować problem w krótkiej rozmowie wspieranej przez AI, uporządkować to, co ważne, i przejść do konkretnych kolejnych działań.',
      cta: 'Zacznij rozwiązywać',
      reassurance: 'Krótka rozmowa. Bez długiego briefu.',
      aside:
        'Dla sytuacji, w których kontekst jest niejasny, kompromisy są realne i potrzebujesz praktycznej drogi naprzód zamiast ogólnej odpowiedzi.',
    },
    how: {
      title: 'Jak to działa',
      steps: [
        { title: 'Opisz problem', body: 'Zacznij od tego, co wiesz, nawet jeśli opis jest niepełny lub chaotyczny.' },
        { title: 'Doprecyzuj, co jest ważne', body: 'AI zadaje ukierunkowane pytania i pomaga odkryć brakujące informacje.' },
        { title: 'Otrzymaj plan działania', body: 'Zamień rozmowę w uporządkowane kolejne kroki, z których możesz skorzystać.' },
      ],
    },
    conversation: {
      title: 'Co robi rozmowa',
      cards: [
        'Zadaje ukierunkowane pytania zamiast zbyt wcześnie generować ogólną odpowiedź.',
        'Szuka brakujących informacji, niejasnych założeń i sprzecznych wymagań.',
        'Porządkuje to, co już wiadomo, aby łatwiej zobaczyć właściwą decyzję.',
        'Prowadzi do konkretnych kolejnych działań w uporządkowanym rozwiązywaniu problemu.',
      ],
    },
    examples: {
      title: 'Problemy, w których może pomóc',
      items: [
        { title: 'Problem techniczny lub produktowy', body: 'Doprecyzuj objawy, ograniczenia i prawdopodobne kolejne sprawdzenia.' },
        { title: 'Blokada w projekcie lub procesie', body: 'Oddziel fakty, założenia i luki koordynacyjne.' },
        { title: 'Decyzja z kompromisami', body: 'Porównaj sprzeczne wymagania przed wyborem kierunku.' },
        { title: 'Niejasna przyczyna źródłowa', body: 'Zmapuj to, co wiadomo, zanim przejdziesz do rozwiązania.' },
      ],
    },
    finalCta: {
      title: 'Zacznij od problemu, który masz teraz',
      body:
        'Wystarczy kilka konkretnych odpowiedzi, żeby zacząć. MakeMyProblem.Work pomoże doprecyzować sytuację i przygotować praktyczny plan działania.',
      cta: 'Zacznij rozwiązywać',
    },
    footer: {
      tagline: 'Aplikacje webowe wspierane przez AI do rozwiązywania problemów.',
      disclaimer: 'Wyniki generowane przez AI wymagają niezależnej walidacji i nie są zatwierdzeniem produkcyjnym.',
      copyright: '© 2026 MakeMyProblemWork Wszelkie prawa zastrzeżone.',
    },
  },
  {
    lang: 'de',
    pathname: '/de',
    title: 'MakeMyProblem.Work - Problemlösung mit KI und Aktionsplan',
    description:
      'MakeMyProblem.Work hilft, ein Problem in einem kurzen KI-gestützten Gespräch zu klären und daraus konkrete nächste Schritte abzuleiten.',
    nav: {
      home: 'Start',
      howItWorks: 'So funktioniert es',
      examples: 'Beispiele',
      pricing: 'Preise',
      about: 'Über uns',
      login: 'Login',
    },
    hero: {
      eyebrow: 'KI-gestützte Problemlösung',
      title: 'Vom Problem zum Aktionsplan',
      copy:
        'MakeMyProblem.Work hilft, ein Problem in einem kurzen KI-gestützten Gespräch zu klären, das Wesentliche zu strukturieren und konkrete nächste Schritte abzuleiten.',
      cta: 'Problem lösen',
      reassurance: 'Kurzes Gespräch. Kein langes Briefing erforderlich.',
      aside:
        'Für Situationen, in denen die Lage unklar ist, echte Zielkonflikte bestehen und ein praktischer Weg nach vorn wichtiger ist als eine generische Antwort.',
    },
    how: {
      title: 'So funktioniert es',
      steps: [
        { title: 'Problem beschreiben', body: 'Beginne mit dem, was du weißt, auch wenn es unvollständig oder unsortiert ist.' },
        { title: 'Wichtiges klären', body: 'Die KI stellt gezielte Fragen und hilft, fehlende Informationen sichtbar zu machen.' },
        { title: 'Aktionsplan erhalten', body: 'Verwandle das Gespräch in strukturierte nächste Schritte, die du nutzen kannst.' },
      ],
    },
    conversation: {
      title: 'Was das Gespräch leistet',
      cards: [
        'Es stellt gezielte Fragen, statt zu früh eine allgemeine Antwort zu liefern.',
        'Es sucht nach fehlenden Informationen, unklaren Annahmen und widersprüchlichen Anforderungen.',
        'Es strukturiert das bereits Bekannte, damit die eigentliche Entscheidung leichter erkennbar wird.',
        'Es führt zu konkreten nächsten Schritten für eine strukturierte Problemlösung.',
      ],
    },
    examples: {
      title: 'Probleme, bei denen es helfen kann',
      items: [
        { title: 'Technisches oder produktbezogenes Problem', body: 'Kläre Symptome, Rahmenbedingungen und wahrscheinliche nächste Prüfungen.' },
        { title: 'Blockade im Projekt oder Prozess', body: 'Trenne Fakten, Annahmen und Abstimmungslücken.' },
        { title: 'Entscheidung mit Zielkonflikten', body: 'Vergleiche widersprüchliche Anforderungen, bevor du eine Richtung wählst.' },
        { title: 'Unklare Grundursache', body: 'Ordne das Bekannte, bevor du zu einer Lösung springst.' },
      ],
    },
    finalCta: {
      title: 'Beginne mit dem Problem, das du jetzt hast',
      body:
        'Einige gezielte Antworten reichen aus, um anzufangen. MakeMyProblem.Work hilft dir, die Situation zu klären und einen praktischen Aktionsplan zu formen.',
      cta: 'Problem lösen',
    },
    footer: {
      tagline: 'KI-gestützte Web-Apps für Problemlösung.',
      disclaimer: 'KI-generierte Ergebnisse erfordern eine unabhängige Validierung und sind keine Produktionsfreigabe.',
      copyright: '© 2026 MakeMyProblemWork Alle Rechte vorbehalten.',
    },
  },
]

const styles = `
    :root {
      color-scheme: light;
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f4ef;
      color: #16241d;
      font-synthesis: none;
      scroll-behavior: smooth;
      text-rendering: optimizeLegibility;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-width: 320px;
      background:
        radial-gradient(circle at 85% 4%, rgba(88, 132, 103, 0.18), transparent 30rem),
        linear-gradient(180deg, #f7f6f1 0%, #e9ece2 100%);
      color: #16241d;
    }

    a {
      color: inherit;
    }

    .site-header {
      position: sticky;
      top: 0;
      z-index: 20;
      border-bottom: 1px solid rgba(29, 58, 42, 0.12);
      background: rgba(255, 255, 255, 0.96);
      backdrop-filter: blur(14px);
    }

    .site-header__inner {
      width: min(100%, 1120px);
      min-height: 82px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 30px;
      padding: 0 20px;
    }

    .site-header__logo-link {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
    }

    .site-header__logo {
      display: block;
      width: auto;
      height: 68px;
      max-height: calc(82px - 14px);
    }

    .site-header__toggle {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .site-header__toggle-button {
      display: none;
    }

    .site-header__menu {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 28px;
    }

    .site-header__link,
    .site-header__login {
      display: inline-flex;
      min-height: 40px;
      align-items: center;
      justify-content: center;
      color: #17263c;
      font-size: 0.95rem;
      font-weight: 400;
      line-height: 1;
      text-decoration: none;
      white-space: nowrap;
    }

    .site-header__language {
      position: relative;
      color: #17263c;
      font-size: 0.95rem;
      font-weight: 400;
      line-height: 1;
    }

    .site-header__language summary {
      display: inline-flex;
      min-height: 40px;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px solid #d8dde6;
      border-radius: 7px;
      background: #ffffff;
      color: #17263c;
      padding: 0 12px;
      cursor: pointer;
      list-style: none;
      white-space: nowrap;
    }

    .site-header__language summary::-webkit-details-marker {
      display: none;
    }

    .site-header__language-icon {
      width: 15px;
      height: 15px;
      color: #0057d9;
    }

    .site-header__chevron {
      width: 12px;
      height: 12px;
      color: #53637a;
    }

    .site-header__language[open] .site-header__chevron {
      transform: rotate(180deg);
    }

    .site-header__language-menu {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 30;
      min-width: 180px;
      border: 1px solid #d8dde6;
      border-radius: 7px;
      background: #ffffff;
      padding: 7px;
      box-shadow: 0 18px 36px rgba(23, 38, 60, 0.14);
    }

    .site-header__language-option {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr) 32px;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      border-radius: 5px;
      color: #17263c;
      padding: 0 8px;
      font-size: 0.9rem;
      font-weight: 400;
      text-decoration: none;
    }

    .site-header__language-option[aria-current="page"] {
      background: #eaf2ff;
      color: #0057d9;
    }

    .site-header__language-check,
    .site-header__language-code {
      font-size: 0.78rem;
      font-weight: 400;
    }

    .site-header__language-check {
      color: #0057d9;
    }

    .site-header__language-code {
      justify-self: end;
      color: #53637a;
    }

    .site-header__language-option[aria-current="page"] .site-header__language-code {
      color: #0057d9;
    }

    .site-header__login {
      min-width: 78px;
      border: 1px solid #0b5fff;
      border-radius: 7px;
      background: #ffffff;
      color: #0057d9;
      padding: 0 14px;
    }

    .page {
      width: min(100%, 1120px);
      margin: 0 auto;
      padding: 22px 20px 40px;
    }

    .hero {
      display: grid;
      gap: 28px;
      padding: 18px 0 46px;
      border-top: 0;
    }

    .eyebrow {
      margin: 0 0 16px;
      color: #4f6b59;
      font-size: 0.85rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    h1 {
      max-width: 12ch;
      margin: 0;
      font-size: clamp(3.3rem, 15vw, 7.8rem);
      line-height: 0.9;
      letter-spacing: 0;
    }

    .hero-copy {
      max-width: 38rem;
      margin: 20px 0 0;
      color: #314338;
      font-size: clamp(1.08rem, 4.5vw, 1.35rem);
      line-height: 1.5;
    }

    .cta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 14px;
      margin-top: 28px;
    }

    .cta {
      display: inline-flex;
      min-height: 52px;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: #1d3a2a;
      color: #fffaf0;
      padding: 0 24px;
      font-weight: 800;
      text-decoration: none;
      box-shadow: 0 18px 42px rgba(23, 54, 36, 0.2);
    }

    .reassurance {
      margin: 0;
      color: #5e695f;
      font-size: 0.95rem;
      line-height: 1.45;
    }

    section {
      padding: 34px 0;
      border-top: 1px solid rgba(49, 72, 58, 0.16);
      scroll-margin-top: 96px;
    }

    h2 {
      margin: 0 0 18px;
      color: #1d3226;
      font-size: clamp(1.55rem, 7vw, 2.5rem);
      line-height: 1.05;
      letter-spacing: 0;
    }

    .steps,
    .use-cases {
      display: grid;
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .steps li,
    .use-cases li,
    .conversation-card {
      border: 1px solid rgba(29, 58, 42, 0.14);
      border-radius: 24px;
      background: rgba(255, 252, 244, 0.74);
      padding: 18px;
      box-shadow: 0 12px 30px rgba(30, 51, 38, 0.07);
    }

    .steps strong,
    .use-cases strong {
      display: block;
      margin-bottom: 6px;
      color: #1c3527;
      font-size: 1.03rem;
    }

    .steps span,
    .use-cases span,
    .conversation-card p {
      color: #4b5e51;
      line-height: 1.55;
    }

    .conversation-grid {
      display: grid;
      gap: 12px;
    }

    .conversation-card p {
      margin: 0;
    }

    .final-cta {
      padding-bottom: 16px;
    }

    .final-cta p {
      max-width: 34rem;
      color: #3e5145;
      line-height: 1.55;
    }

    .site-footer {
      background: #1d3a2a;
      color: #fffaf0;
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .site-footer__inner {
      width: min(100%, 1120px);
      min-height: 252px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 24px;
      padding: 34px 20px 30px;
    }

    .site-footer__top,
    .site-footer__disclaimer-row,
    .site-footer__copyright-row {
      width: 100%;
    }

    .site-footer__top {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 28px;
    }

    .site-footer__brand {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 14px;
    }

    .site-footer__logo-link {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
    }

    .site-footer__logo {
      display: block;
      width: auto;
      height: 46px;
    }

    .site-footer__tagline {
      margin: 0;
      color: rgba(255, 250, 240, 0.6);
      font-size: 0.84rem;
      font-weight: 200;
      line-height: 1.35;
      transform: translateY(15px);
    }

    .site-footer__links {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }

    .site-footer__link {
      display: inline-flex;
      min-height: 34px;
      align-items: center;
      justify-content: center;
      color: #fffaf0;
      padding: 0 7px;
      font-size: 0.82rem;
      font-weight: 400;
      line-height: 1;
      text-decoration: none;
      white-space: nowrap;
    }

    .site-footer__disclaimer-row,
    .site-footer__copyright-row {
      border-top: 1px solid rgba(255, 250, 240, 0.17);
      padding-top: 25px;
    }

    .site-footer__disclaimer,
    .site-footer__copyright {
      margin: 0;
      color: rgba(255, 250, 240, 0.58);
      font-size: 0.76rem;
      font-weight: 200;
      line-height: 1.45;
    }

    .site-footer__disclaimer strong {
      color: rgba(255, 250, 240, 0.72);
      font-weight: 200;
    }

    @media (min-width: 768px) {
      .site-header__inner {
        padding: 0 36px;
      }

      .page {
        padding: 34px 36px 58px;
      }

      .hero {
        min-height: 72vh;
        align-items: center;
        grid-template-columns: minmax(0, 1.05fr) minmax(17rem, 0.55fr);
      }

      .hero-aside {
        border-left: 1px solid rgba(49, 72, 58, 0.18);
        padding-left: 28px;
      }

      .steps,
      .use-cases {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .use-cases {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .conversation-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 720px) {
      .site-footer__inner {
        min-height: 0;
        gap: 18px;
        padding: 28px 18px 30px;
      }

      .site-header__inner {
        min-height: 68px;
        padding: 0 16px;
      }

      .site-header__logo {
        height: 58px;
        max-height: calc(68px - 10px);
      }

      .site-header__toggle-button {
        display: inline-flex;
        width: 42px;
        height: 42px;
        align-items: center;
        justify-content: center;
        border: 1px solid #d8dde6;
        border-radius: 7px;
        background: #ffffff;
        cursor: pointer;
      }

      .site-header__toggle-button span,
      .site-header__toggle-button::before,
      .site-header__toggle-button::after {
        display: block;
        width: 22px;
        height: 2px;
        border-radius: 999px;
        background: #17263c;
        content: "";
      }

      .site-header__toggle-button {
        flex-direction: column;
        gap: 5px;
      }

      .site-header__menu {
        position: absolute;
        left: 0;
        right: 0;
        top: 100%;
        display: none;
        flex-direction: column;
        align-items: stretch;
        gap: 0;
        border-top: 1px solid rgba(29, 58, 42, 0.12);
        border-bottom: 1px solid rgba(29, 58, 42, 0.12);
        background: #ffffff;
        padding: 14px 16px 20px;
        box-shadow: 0 18px 40px rgba(23, 38, 60, 0.1);
      }

      .site-header__toggle:checked ~ .site-header__menu {
        display: flex;
      }

      .site-header__link {
        min-height: 46px;
        justify-content: flex-start;
      }

      .site-header__language,
      .site-header__login {
        width: 100%;
        min-height: 40px;
        margin-top: 10px;
      }

      .site-header__language summary {
        width: 100%;
      }

      .site-header__language-menu {
        position: static;
        width: 100%;
        margin-top: 8px;
      }

      .site-footer__top {
        grid-template-columns: 1fr;
        justify-items: start;
        gap: 16px;
      }

      .site-footer__brand {
        flex-wrap: wrap;
        gap: 10px;
      }

      .site-footer__logo {
        height: 38px;
      }

      .site-footer__links {
        gap: 8px;
        justify-content: flex-start;
      }

      .site-footer__link {
        min-height: 32px;
        padding: 0 5px;
        font-size: 0.82rem;
      }

      .site-footer__disclaimer-row,
      .site-footer__copyright-row {
        padding-top: 18px;
      }
    }

    @media (prefers-reduced-motion: no-preference) {
      .cta {
        transition: transform 160ms ease, box-shadow 160ms ease;
      }

      .cta:hover {
        transform: translateY(-1px);
        box-shadow: 0 22px 48px rgba(23, 54, 36, 0.24);
      }
    }
  `

const languages = [
  { lang: 'en', name: 'English', code: 'EN' },
  { lang: 'de', name: 'Deutsch', code: 'DE' },
  { lang: 'pl', name: 'Polski', code: 'PL' },
] as const

const globeIcon = `<svg class="site-header__language-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
              <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>`

const chevronIcon = `<svg class="site-header__chevron" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>`

const renderLanguageSwitcher = (activeLang: LandingLang) => {
  const activeLanguage = languages.find((language) => language.lang === activeLang) || languages[0]
  const options = languages
    .map((language) => {
      const current = language.lang === activeLang ? ' aria-current="page"' : ''
      const check = language.lang === activeLang ? '&#10003;' : ''
      return `<a class="site-header__language-option" href="/${language.lang}" lang="${language.lang}"${current}>
              <span class="site-header__language-check" aria-hidden="true">${check}</span>
              <span>${language.name}</span>
              <span class="site-header__language-code">${language.code}</span>
            </a>`
    })
    .join('\n            ')

  return `<details class="site-header__language">
            <summary aria-label="Change language">
              ${globeIcon}
              <span>${activeLanguage.code}</span>
              ${chevronIcon}
            </summary>
            <div class="site-header__language-menu">
            ${options}
            </div>
          </details>`
}

const renderLandingBody = (content: LandingContent) => `
    <header class="site-header" aria-label="Primary navigation">
      <div class="site-header__inner">
        <a class="site-header__logo-link" href="/${content.lang}" aria-label="MakeMyProblem.Work home">
          <img class="site-header__logo" src="/logo/logo_makemyproblemwork_transp.png" alt="MakeMyProblem.Work" />
        </a>
        <input class="site-header__toggle" id="site-header-menu-toggle" type="checkbox" />
        <label class="site-header__toggle-button" for="site-header-menu-toggle" aria-label="Open menu">
          <span></span>
        </label>
        <nav class="site-header__menu" aria-label="Primary menu">
          <a class="site-header__link" href="#home">${content.nav.home}</a>
          <a class="site-header__link" href="#how-it-works">${content.nav.howItWorks}</a>
          <a class="site-header__link" href="#examples">${content.nav.examples}</a>
          <a class="site-header__link" href="#pricing">${content.nav.pricing}</a>
          <a class="site-header__link" href="https://www.aremai.tech">${content.nav.about}</a>
          ${renderLanguageSwitcher(content.lang)}
          <a class="site-header__login" href="${makeMyProblemSite.primaryAppRoute}">${content.nav.login}</a>
        </nav>
      </div>
    </header>
    <div class="page">
      <main>
        <section id="home" class="hero" aria-labelledby="hero-title">
          <div>
            <p class="eyebrow">${content.hero.eyebrow}</p>
            <h1 id="hero-title">${content.hero.title}</h1>
            <p class="hero-copy">${content.hero.copy}</p>
            <div class="cta-row">
              <a class="cta" href="${makeMyProblemSite.primaryAppRoute}">${content.hero.cta}</a>
              <p class="reassurance">${content.hero.reassurance}</p>
            </div>
          </div>
          <aside class="hero-aside" aria-label="What you get">
            <p class="reassurance">${content.hero.aside}</p>
          </aside>
        </section>

        <section id="how-it-works" aria-labelledby="how-title">
          <h2 id="how-title">${content.how.title}</h2>
          <ul class="steps">
            ${content.how.steps
              .map(
                (step) => `<li>
              <strong>${step.title}</strong>
              <span>${step.body}</span>
            </li>`
              )
              .join('\n            ')}
          </ul>
        </section>

        <section aria-labelledby="conversation-title">
          <h2 id="conversation-title">${content.conversation.title}</h2>
          <div class="conversation-grid">
            ${content.conversation.cards
              .map(
                (card) => `<div class="conversation-card">
              <p>${card}</p>
            </div>`
              )
              .join('\n            ')}
          </div>
        </section>

        <section id="examples" aria-labelledby="use-cases-title">
          <h2 id="use-cases-title">${content.examples.title}</h2>
          <ul class="use-cases">
            ${content.examples.items
              .map(
                (item) => `<li>
              <strong>${item.title}</strong>
              <span>${item.body}</span>
            </li>`
              )
              .join('\n            ')}
          </ul>
        </section>

        <section id="pricing" class="final-cta" aria-labelledby="final-title">
          <h2 id="final-title">${content.finalCta.title}</h2>
          <p>${content.finalCta.body}</p>
          <a class="cta" href="${makeMyProblemSite.primaryAppRoute}">${content.finalCta.cta}</a>
        </section>
      </main>
    </div>
    <footer class="site-footer" aria-label="Aremai footer">
      <div class="site-footer__inner">
        <div class="site-footer__top">
          <div class="site-footer__brand">
            <a
              class="site-footer__logo-link"
              href="https://www.aremai.tech"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Aremai website"
            >
              <img class="site-footer__logo" src="/logo/aremai_logo_footer.webp" alt="Aremai" loading="lazy" />
            </a>
            <p class="site-footer__tagline">${content.footer.tagline}</p>
          </div>
        <nav class="site-footer__links" aria-label="Footer links">
          <a class="site-footer__link" href="https://www.aremai.tech">About</a>
          <a class="site-footer__link" href="mailto:contact@aremai.tech">Contact</a>
          <a class="site-footer__link" href="/privacy">Privacy Policy</a>
          <a class="site-footer__link" href="/termsandconditions">Terms and Service</a>
          <a class="site-footer__link" href="${makeMyProblemSite.primaryAppRoute}">Login</a>
        </nav>
        </div>
        <div class="site-footer__disclaimer-row">
          <p class="site-footer__disclaimer">
            <strong>Disclaimer:</strong> ${content.footer.disclaimer}
          </p>
        </div>
        <div class="site-footer__copyright-row">
          <p class="site-footer__copyright">${content.footer.copyright}</p>
        </div>
      </div>
    </footer>
  `

export const makeMyProblemHomePages: readonly HtmlPublicPageDefinition[] = landingContent.map(
  (content) => ({
    siteId: makeMyProblemSite.id,
    pathname: content.pathname,
    lang: content.lang,
    title: content.title,
    description: content.description,
    alternateLinks,
    cta: {
      label: content.hero.cta,
      href: makeMyProblemSite.primaryAppRoute,
    },
    styles,
    bodyHtml: renderLandingBody(content),
  })
)
