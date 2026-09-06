import type { HtmlPublicPageDefinition } from '../publicPages'
import { siteConfigs } from '../siteConfig'
import {
  makeMyProblemStyles,
  renderMakeMyProblemAppLink,
  renderMakeMyProblemFooter,
  renderMakeMyProblemHeader,
  type MakeMyProblemLandingLang,
} from './landing'

type UseCasePageSection = {
  heading: string
  intro: string
  items: readonly string[]
}

type UseCasePageDefinition = {
  slug: string
  lang: MakeMyProblemLandingLang
  title: string
  metaDescription: string
  indexable: false
  sourceUseCaseKey: string
  hero: {
    eyebrow: string
    title: string
    description: string
    cta: string
    backLink: string
  }
  situation: UseCasePageSection
  difficulty: UseCasePageSection
  workflow: UseCasePageSection
  scenario: {
    heading: string
    slots: readonly string[]
  }
  output: UseCasePageSection
  fit: UseCasePageSection
  finalCta: {
    heading: string
    description: string
    cta: string
  }
}

const makeMyProblemSite = siteConfigs.makeMyProblem

const englishNav = {
  home: 'Home',
  howItWorks: 'How It Works',
  examples: 'Examples',
  pricing: 'Pricing',
  about: 'About',
  login: 'Login',
}

const englishFooter = {
  tagline: 'AI-assisted web apps for problem solving.',
  disclaimer: 'AI-generated outputs require independent validation and are not production approval.',
  copyright: '© 2026 MakeMyProblemWork All rights reserved.',
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
}

const draftIntro =
  'This draft page is structurally prepared for approved use-case content and is temporarily kept out of search indexing.'

const makeUseCasePathname = (lang: MakeMyProblemLandingLang, slug: string) => `/${lang}/use-cases/${slug}` as const

const useCasePageStyles = `
    .use-case-page {
      width: min(100%, 1120px);
      margin: 0 auto;
      padding: 22px 20px 40px;
    }

    .use-case-hero {
      display: grid;
      gap: 24px;
      padding: 18px 0 54px;
    }

    .use-case-hero h1 {
      max-width: 13ch;
    }

    .use-case-hero__back {
      display: inline-flex;
      width: fit-content;
      min-height: 38px;
      align-items: center;
      color: #0057d9;
      font-size: 0.95rem;
      font-weight: 700;
      text-decoration: none;
    }

    .use-case-layout {
      display: grid;
      gap: 0;
    }

    .use-case-section {
      padding: 58px 0;
    }

    .use-case-section p {
      max-width: 44rem;
      color: #3e5145;
      line-height: 1.58;
    }

    .use-case-card-grid {
      display: grid;
      gap: 12px;
      margin-top: 24px;
    }

    .use-case-detail-card,
    .use-case-scenario,
    .use-case-output-card {
      border: 1px solid rgba(29, 58, 42, 0.14);
      border-radius: 24px;
      background: rgba(255, 252, 244, 0.78);
      padding: 18px;
      box-shadow: 0 12px 30px rgba(30, 51, 38, 0.07);
    }

    .use-case-detail-card {
      min-height: 112px;
    }

    .use-case-detail-card h3,
    .use-case-output-card h3 {
      margin: 0;
      color: #1c3527;
      font-size: 1.03rem;
      line-height: 1.2;
    }

    .use-case-detail-card p,
    .use-case-output-card p {
      margin: 10px 0 0;
      color: #4b5e51;
      line-height: 1.55;
    }

    .use-case-band--detail {
      width: 100vw;
      margin-left: calc(50% - 50vw);
      background: #d7e0d3;
      padding: 64px 0;
    }

    .use-case-band--detail .use-case-band__inner {
      width: min(100%, 1120px);
      margin: 0 auto;
      padding: 0 20px;
    }

    .use-case-scenario {
      display: grid;
      gap: 12px;
      margin-top: 24px;
      background: rgba(255, 252, 244, 0.92);
    }

    .use-case-scenario__slot {
      border-left: 3px solid rgb(203, 33, 127);
      padding-left: 14px;
    }

    .use-case-output-list {
      display: grid;
      gap: 12px;
      margin-top: 24px;
    }

    .use-case-fit {
      display: grid;
      gap: 12px;
      margin-top: 24px;
    }

    @media (min-width: 768px) {
      .use-case-page {
        padding: 34px 36px 58px;
      }

      .use-case-hero {
        min-height: 54vh;
        align-items: center;
        grid-template-columns: minmax(0, 1fr) minmax(16rem, 0.42fr);
      }

      .use-case-card-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .use-case-output-list,
      .use-case-fit {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .use-case-band--detail .use-case-band__inner {
        padding: 0 36px;
      }
    }

    @media (max-width: 720px) {
      .use-case-section {
        padding: 46px 0;
      }

      .use-case-band--detail {
        padding: 52px 0;
      }
    }
`

const useCasePages: readonly UseCasePageDefinition[] = [
  {
    slug: 'conflicting-technical-requirements',
    lang: 'en',
    title: 'DEVELOPMENT-ONLY Conflicting Technical Requirements | MakeMyProblem',
    metaDescription:
      'Development-only structure for a future MakeMyProblem use-case page. Final SEO copy is not published yet.',
    indexable: false,
    sourceUseCaseKey: 'conflicting-requirements',
    hero: {
      eyebrow: 'Use case structure',
      title: 'Conflicting technical requirements',
      description: draftIntro,
      cta: "Let's work on it",
      backLink: 'Back to MakeMyProblem',
    },
    situation: {
      heading: 'Problem situation',
      intro: 'Reserved structure for the user context, problem setting and why the situation is difficult.',
      items: ['User context slot', 'Technical context slot', 'Decision pressure slot'],
    },
    difficulty: {
      heading: 'What makes this difficult',
      intro: 'Reserved structure for constraints, missing information, conflicting inputs and uncertainty sources.',
      items: ['Constraint slot', 'Missing information slot', 'Conflicting input slot', 'Uncertainty slot'],
    },
    workflow: {
      heading: 'How MakeMyProblem helps',
      intro: 'Reserved structure for the guided conversation workflow and transition toward practical next actions.',
      items: ['Clarification step slot', 'Assumption check slot', 'Option framing slot', 'Action plan step slot'],
    },
    scenario: {
      heading: 'Example scenario',
      slots: ['Input/situation slot', 'Key constraints slot', 'Questions explored slot', 'Next actions slot'],
    },
    output: {
      heading: 'Example output / action plan',
      intro: 'Reserved structure for checks, decisions, assumptions and next actions without promising a final solution.',
      items: ['Next action slot', 'Check slot', 'Decision slot'],
    },
    fit: {
      heading: 'When this use case fits',
      intro: 'Reserved structure for fit, limits and the need for independent engineering validation.',
      items: ['Useful when slot', 'Not enough when slot', 'Validation needed slot'],
    },
    finalCta: {
      heading: 'Start with the problem you have now',
      description: 'Reserved CTA structure pointing to the existing MakeMyProblem flow.',
      cta: "Let's work on it",
    },
  },
  {
    slug: 'technical-customer-complaint',
    lang: 'en',
    title: 'DEVELOPMENT-ONLY Technical Customer Complaint | MakeMyProblem',
    metaDescription:
      'Development-only structure for a future MakeMyProblem use-case page. Final SEO copy is not published yet.',
    indexable: false,
    sourceUseCaseKey: 'customer-complaint',
    hero: {
      eyebrow: 'Use case structure',
      title: 'Technical customer complaint',
      description: draftIntro,
      cta: "Let's work on it",
      backLink: 'Back to MakeMyProblem',
    },
    situation: {
      heading: 'Problem situation',
      intro: 'Reserved structure for the user context, problem setting and why the situation is difficult.',
      items: ['Customer context slot', 'Technical symptom slot', 'Response pressure slot'],
    },
    difficulty: {
      heading: 'What makes this difficult',
      intro: 'Reserved structure for constraints, missing information, conflicting inputs and uncertainty sources.',
      items: ['Missing evidence slot', 'Likely cause slot', 'Customer impact slot', 'Next check slot'],
    },
    workflow: {
      heading: 'How MakeMyProblem helps',
      intro: 'Reserved structure for the guided conversation workflow and transition toward practical next actions.',
      items: ['Complaint framing slot', 'Information gap slot', 'Check planning slot', 'Action plan step slot'],
    },
    scenario: {
      heading: 'Example scenario',
      slots: ['Input/situation slot', 'Key constraints slot', 'Questions explored slot', 'Next actions slot'],
    },
    output: {
      heading: 'Example output / action plan',
      intro: 'Reserved structure for checks, decisions, assumptions and next actions without promising a final solution.',
      items: ['Next action slot', 'Check slot', 'Decision slot'],
    },
    fit: {
      heading: 'When this use case fits',
      intro: 'Reserved structure for fit, limits and the need for independent engineering validation.',
      items: ['Useful when slot', 'Not enough when slot', 'Validation needed slot'],
    },
    finalCta: {
      heading: 'Start with the problem you have now',
      description: 'Reserved CTA structure pointing to the existing MakeMyProblem flow.',
      cta: "Let's work on it",
    },
  },
]

const renderCards = (items: readonly string[]) =>
  items
    .map(
      (item) => `<article class="use-case-detail-card">
                <h3>${item}</h3>
              </article>`
    )
    .join('\n              ')

const renderOutputCards = (items: readonly string[]) =>
  items
    .map(
      (item) => `<article class="use-case-output-card">
                <h3>${item}</h3>
              </article>`
    )
    .join('\n              ')

const renderUseCasePage = (page: UseCasePageDefinition) => `
    ${renderMakeMyProblemHeader(page.lang, englishNav)}
    <div class="use-case-page">
      <main class="use-case-layout" data-use-case-page="${page.slug}" data-source-use-case="${page.sourceUseCaseKey}">
        <section id="home" class="use-case-hero" aria-labelledby="hero-title">
          <div>
            <p class="eyebrow">${page.hero.eyebrow}</p>
            <h1 id="hero-title">${page.hero.title}</h1>
            <p class="hero-copy">${page.hero.description}</p>
            <div class="cta-row">
              ${renderMakeMyProblemAppLink('cta', page.lang, page.hero.cta)}
            </div>
          </div>
          <aside class="hero-aside" aria-label="Use case navigation">
            <a class="use-case-hero__back" href="/${page.lang}">${page.hero.backLink}</a>
          </aside>
        </section>

        <section class="use-case-section" aria-labelledby="situation-title">
          <h2 id="situation-title">${page.situation.heading}</h2>
          <p>${page.situation.intro}</p>
          <div class="use-case-card-grid">
            ${renderCards(page.situation.items)}
          </div>
        </section>

        <section class="use-case-band--detail" aria-labelledby="difficulty-title">
          <div class="use-case-band__inner">
            <h2 id="difficulty-title">${page.difficulty.heading}</h2>
            <p>${page.difficulty.intro}</p>
            <div class="use-case-card-grid">
              ${renderCards(page.difficulty.items)}
            </div>
          </div>
        </section>

        <section id="how-it-works" class="use-case-section" aria-labelledby="workflow-title">
          <h2 id="workflow-title">${page.workflow.heading}</h2>
          <p>${page.workflow.intro}</p>
          <ul class="steps">
            ${page.workflow.items
              .map(
                (step, index) => `<li>
              <span class="step-number" aria-hidden="true">${index + 1}</span>
              <strong>${step}</strong>
            </li>`
              )
              .join('\n            ')}
          </ul>
        </section>

        <section id="examples" class="use-case-section" aria-labelledby="scenario-title">
          <h2 id="scenario-title">${page.scenario.heading}</h2>
          <div class="use-case-scenario">
            ${page.scenario.slots.map((slot) => `<div class="use-case-scenario__slot">${slot}</div>`).join('\n            ')}
          </div>
        </section>

        <section class="use-case-band--detail" aria-labelledby="output-title">
          <div class="use-case-band__inner">
            <h2 id="output-title">${page.output.heading}</h2>
            <p>${page.output.intro}</p>
            <div class="use-case-output-list">
              ${renderOutputCards(page.output.items)}
            </div>
          </div>
        </section>

        <section class="use-case-section" aria-labelledby="fit-title">
          <h2 id="fit-title">${page.fit.heading}</h2>
          <p>${page.fit.intro}</p>
          <div class="use-case-fit">
            ${renderOutputCards(page.fit.items)}
          </div>
        </section>

        <section id="pricing" class="final-cta" aria-labelledby="final-title">
          <h2 id="final-title">${page.finalCta.heading}</h2>
          <p>${page.finalCta.description}</p>
          ${renderMakeMyProblemAppLink('cta', page.lang, page.finalCta.cta)}
        </section>
      </main>
    </div>
    ${renderMakeMyProblemFooter(page.lang, englishFooter)}
  `

export const makeMyProblemUseCasePages: readonly HtmlPublicPageDefinition[] = useCasePages.map((page) => ({
  siteId: makeMyProblemSite.id,
  pathname: makeUseCasePathname(page.lang, page.slug),
  lang: page.lang,
  title: page.title,
  description: page.metaDescription,
  indexable: page.indexable,
  alternateLinks: [
    {
      hreflang: page.lang,
      href: `${makeMyProblemSite.canonicalUrl}${makeUseCasePathname(page.lang, page.slug)}`,
    },
  ],
  cta: {
    label: page.hero.cta,
    href: makeMyProblemSite.primaryAppRoute,
  },
  styles: `${makeMyProblemStyles}${useCasePageStyles}`,
  bodyHtml: renderUseCasePage(page),
}))
