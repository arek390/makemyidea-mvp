import { useState, type ReactNode } from 'react'
import './MobileLanding.css'

export type MobileLandingLanguage = 'English' | 'Polish'

type MobileLandingProps = {
  language: MobileLandingLanguage
  logoUrl: string
  onLanguageChange: (language: MobileLandingLanguage) => void
  feedbackLabel: string
  onFeedbackOpen: () => void
  feedbackPanel: ReactNode
}

const englishDemoScreenshots = [
  new URL('../../prtscreen/mobile_landingpage/screen_mobile_1.png', import.meta.url).href,
  new URL('../../prtscreen/mobile_landingpage/screen_mobile_2.png', import.meta.url).href,
  new URL('../../prtscreen/mobile_landingpage/screen_mobile_3.png', import.meta.url).href,
  new URL('../../prtscreen/mobile_landingpage/screen_mobile_4.png', import.meta.url).href,
  new URL('../../prtscreen/mobile_landingpage/screen_mobile_5.png', import.meta.url).href,
]

const polishDemoScreenshots = [
  new URL('../../prtscreen/mobile_landingpage/PL/Zrzut ekranu 1.png', import.meta.url).href,
  new URL('../../prtscreen/mobile_landingpage/PL/Zrzut ekranu 2.png', import.meta.url).href,
  new URL('../../prtscreen/mobile_landingpage/PL/Zrzut ekranu 3.png', import.meta.url).href,
  new URL('../../prtscreen/mobile_landingpage/PL/Zrzut ekranu 4.png', import.meta.url).href,
  new URL('../../prtscreen/mobile_landingpage/PL/Zrzut ekranu 5.png', import.meta.url).href,
]

const aremaiLogoUrl = new URL('../../logo/aremai_logo.png.webp', import.meta.url).href
const mobileDemoVideoUrl = 'https://youtube.com/shorts/AkVlKp5aKlY?feature=share'

const mobileCopy = {
  English: {
    languageLabel: 'Language',
    login: 'Log in',
    start: 'See how it works',
    openApp: 'Open app',
    heroTitle: 'Turn an idea into decisions and an action plan.',
    heroBody:
      'MakeMyIdea.work helps structure messy thoughts, expose contradictions, and leave you with the next practical steps.',
    note: 'The full workspace works best on desktop and tablet.',
    howTitle: 'How it works',
    steps: [
      {
        title: 'Describe the idea',
        body: 'Write or speak what you are trying to build, fix, or understand.',
      },
      {
        title: 'AI structures the work',
        body: 'The app organizes contradictions, priorities, and decision points.',
      },
      {
        title: 'Get an action plan',
        body: 'You leave with clear choices and a practical plan for the next session.',
      },
    ],
    demoTitle: 'A focused workspace for idea work',
    demoBody:
      'On desktop and tablet, the workspace gives you the board, key contradictions, decisions, and the action plan in one flow.',
    finalTitle: 'The full workspace is available on desktop and tablet.',
    finalBody:
      'There you can go through the complete process: idea, contradictions, decisions, and action plan.',
    modalTitle: 'Desktop or tablet recommended',
    modalBody: 'The full workspace is currently optimized for desktop and tablet devices.',
    openDesktop: 'Open on desktop',
    copyLink: 'Copy link',
    copied: 'Link copied',
    close: 'Close',
    screenshotAlt: 'Mobile landing page screenshot',
    screenshotOpenLabel: 'Open screenshot',
  },
  Polish: {
    languageLabel: 'Język',
    login: 'Zaloguj',
    start: 'Zobacz jak to działa',
    openApp: 'Otwórz aplikację',
    heroTitle: 'Zamień pomysł w decyzje i plan działania.',
    heroBody:
      'MakeMyIdea.work pomaga uporządkować niejasne myśli, nazwać sprzeczności i dojść do konkretnych kolejnych kroków.',
    note: 'Pełny workspace działa najlepiej na desktopie i tablecie.',
    howTitle: 'Jak to działa',
    steps: [
      {
        title: 'Opisz pomysł',
        body: 'Napisz lub powiedz, co chcesz zbudować, poprawić albo zrozumieć.',
      },
      {
        title: 'AI porządkuje pracę',
        body: 'Aplikacja układa sprzeczności, priorytety i miejsca wymagające decyzji.',
      },
      {
        title: 'Dostajesz plan działania',
        body: 'Wychodzisz z jasnymi wyborami i praktycznym planem na następną sesję.',
      },
    ],
    demoTitle: 'Skupiony workspace do pracy nad pomysłem',
    demoBody:
      'Na desktopie i tablecie workspace prowadzi przez tablicę, kluczowe sprzeczności, decyzje i plan działania w jednym flow.',
    finalTitle: 'Pełny workspace jest dostępny na desktopie i tablecie.',
    finalBody:
      'Tam przejdziesz przez cały proces: pomysł, sprzeczności, decyzje i plan działania.',
    modalTitle: 'Zalecany desktop albo tablet',
    modalBody: 'Pełny workspace jest obecnie zoptymalizowany dla desktopów i tabletów.',
    openDesktop: 'Otwórz na desktopie',
    copyLink: 'Kopiuj link',
    copied: 'Link skopiowany',
    close: 'Zamknij',
    screenshotAlt: 'Zrzut ekranu mobilnej strony',
    screenshotOpenLabel: 'Otwórz zrzut ekranu',
  },
} satisfies Record<MobileLandingLanguage, {
  languageLabel: string
  login: string
  start: string
  openApp: string
  heroTitle: string
  heroBody: string
  note: string
  howTitle: string
  steps: { title: string; body: string }[]
  demoTitle: string
  demoBody: string
  finalTitle: string
  finalBody: string
  modalTitle: string
  modalBody: string
  openDesktop: string
  copyLink: string
  copied: string
  close: string
  screenshotAlt: string
  screenshotOpenLabel: string
}>

export function MobileLanding({
  language,
  logoUrl,
  onLanguageChange,
  feedbackLabel,
  onFeedbackOpen,
  feedbackPanel,
}: MobileLandingProps) {
  const copy = mobileCopy[language]
  const demoScreenshots = language === 'Polish' ? polishDemoScreenshots : englishDemoScreenshots
  const [modalOpen, setModalOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeScreenshot, setActiveScreenshot] = useState<string | null>(null)

  const showWorkspaceNotice = () => {
    setCopied(false)
    setModalOpen(true)
  }

  const copyCurrentLink = async () => {
    if (typeof window === 'undefined') return
    const url = window.location.origin
    try {
      await window.navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = url
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
      setCopied(true)
    }
  }

  return (
    <div className="mobile-landing">
      <header className="mobile-landing__topbar">
        <img className="mobile-landing__logo" src={logoUrl} alt="MakeMyIdea.work" />
        <div className="mobile-landing__top-actions">
          <button type="button" className="mobile-landing__login" onClick={showWorkspaceNotice}>
            {copy.login}
          </button>
          <label className="mobile-landing__language">
            <span>{copy.languageLabel}</span>
            <select
              value={language}
              onChange={(event) => onLanguageChange(event.target.value as MobileLandingLanguage)}
            >
              <option value="Polish">Polish</option>
              <option value="English">English</option>
            </select>
          </label>
        </div>
      </header>

      <main>
        <section className="mobile-landing__hero">
          <p className="mobile-landing__eyebrow">MakeMyIdea.work</p>
          <h1>{copy.heroTitle}</h1>
          <p>{copy.heroBody}</p>
          <a
            className="mobile-landing__cta"
            href={mobileDemoVideoUrl}
            target="_blank"
            rel="noreferrer"
          >
            {copy.start}
          </a>
          <span className="mobile-landing__note">{copy.note}</span>
        </section>

        <section className="mobile-landing__section">
          <h2>{copy.howTitle}</h2>
          <div className="mobile-landing__steps">
            {copy.steps.map((step, index) => (
              <article className="mobile-landing__step" key={step.title}>
                <span>{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mobile-landing__demo" aria-label={copy.demoTitle}>
          <div className="mobile-landing__screenshot-grid">
            {demoScreenshots.map((src, index) => (
              <button
                type="button"
                className="mobile-landing__screenshot-thumb"
                key={src}
                onClick={() => setActiveScreenshot(src)}
                aria-label={`${copy.screenshotOpenLabel} ${index + 1}`}
              >
                <img src={src} alt={`${copy.screenshotAlt} ${index + 1}`} loading="lazy" />
              </button>
            ))}
          </div>
          <div>
            <h2>{copy.demoTitle}</h2>
            <p>{copy.demoBody}</p>
          </div>
        </section>

        <section className="mobile-landing__final">
          <h2>{copy.finalTitle}</h2>
          <p>{copy.finalBody}</p>
          <button type="button" className="mobile-landing__cta" onClick={showWorkspaceNotice}>
            {copy.openApp}
          </button>
        </section>
      </main>

      <footer className="mobile-landing__footer">
        <a href="https://aremai.tech" target="_blank" rel="noreferrer">
          <img src={aremaiLogoUrl} alt="AREMAI" />
        </a>
      </footer>

      {modalOpen && (
        <div className="mobile-landing__modal-backdrop" role="presentation">
          <div className="mobile-landing__modal" role="dialog" aria-modal="true" aria-labelledby="mobile-landing-modal-title">
            <h2 id="mobile-landing-modal-title">{copy.modalTitle}</h2>
            <p>{copy.modalBody}</p>
            <div className="mobile-landing__modal-actions">
              <button type="button" className="mobile-landing__cta" onClick={copyCurrentLink}>
                {copy.openDesktop}
              </button>
              <button type="button" className="mobile-landing__secondary" onClick={copyCurrentLink}>
                {copied ? copy.copied : copy.copyLink}
              </button>
            </div>
            <button type="button" className="mobile-landing__close" onClick={() => setModalOpen(false)}>
              {copy.close}
            </button>
          </div>
        </div>
      )}

      {activeScreenshot && (
        <div className="mobile-landing__lightbox" role="presentation" onClick={() => setActiveScreenshot(null)}>
          <button
            type="button"
            className="mobile-landing__lightbox-close"
            onClick={() => setActiveScreenshot(null)}
            aria-label={copy.close}
          >
            {copy.close}
          </button>
          <img
            src={activeScreenshot}
            alt={copy.screenshotAlt}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}

      {feedbackPanel}
      {!modalOpen && !activeScreenshot && (
        <button type="button" className="feedback-fab" onClick={onFeedbackOpen}>
          {feedbackLabel}
        </button>
      )}
    </div>
  )
}
