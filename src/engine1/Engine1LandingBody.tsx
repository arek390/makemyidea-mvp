import type { MouseEvent as ReactMouseEvent } from 'react'
import type { Language, Translations } from '../App'

export type Engine1LandingBodyProps = {
  copy: Translations
  handleLandingCtaClick: (event?: ReactMouseEvent<HTMLAnchorElement>) => void
  landingView: 'main' | 'threeSteps'
  openMainLanding: () => void
  showLanding: boolean
  uiLanguage: Language
}

export function Engine1LandingBody({
  copy,
  handleLandingCtaClick,
  landingView,
  openMainLanding,
  showLanding,
  uiLanguage,
}: Engine1LandingBodyProps) {
  return (
    <>
      {showLanding && landingView === 'main' && (
        <section className="landing">
          <div className="landing-section hero in-view">
            <div className="landing-inner">
              <h1>{copy.landingHeroTitle}</h1>
              <p>{copy.landingHeroSubtitle}</p>
              {copy.landingHeroBullets.length > 0 && (
                <ul className="landing-hero-bullets">
                  {copy.landingHeroBullets.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              {uiLanguage === 'Polish' && (
                <a
                  className="primary landing-cta landing-cta-video"
                  href="https://youtube.com/shorts/1JDZenJneEE?feature=share"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="landing-cta-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="36" height="36">
                      <path
                        fill="currentColor"
                        d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2.2l4.4 2.2a1 1 0 0 0 1.6-.8V8a1 1 0 0 0-1.6-.8L15 9.4V8a2 2 0 0 0-2-2H4z"
                      />
                    </svg>
                  </span>
                  Zobacz jak to działa (2 min)
                </a>
              )}
              {uiLanguage === 'English' && (
                <a
                  className="primary landing-cta landing-cta-video"
                  href="https://youtube.com/shorts/1JDZenJneEE?feature=share"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="landing-cta-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="36" height="36">
                      <path
                        fill="currentColor"
                        d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2.2l4.4 2.2a1 1 0 0 0 1.6-.8V8a1 1 0 0 0-1.6-.8L15 9.4V8a2 2 0 0 0-2-2H4z"
                      />
                    </svg>
                  </span>
                  Watch how it works (2 min)
                </a>
              )}
              <div className="landing-hero-secondary-cta">
                <a className="primary landing-cta" href="/engine_2">
                  {copy.landingHeroTryWithoutSignupCta}
                </a>
                <div className="landing-microcopy landing-hero-secondary-note">
                  {copy.landingHeroTryWithoutSignupNote}
                </div>
              </div>
            </div>
          </div>

          <div className="landing-section intro">
            <div className="landing-inner">
              <div className="intro-title">
                <span className="title-brand">{copy.landingIntroTitleLines[0]}</span>
                {copy.landingIntroTitleLines.slice(1).map((line) => (
                  <span key={line} className="title-line">
                    {line}
                  </span>
                ))}
              </div>
              <p className="intro-subtext">
                {copy.landingIntroSubtextLines
                  .filter((line) => line.trim().length > 0)
                  .map((line, index) => (
                    <span key={`intro-subtext-${index}`}>
                      {line.includes('{emphasis}')
                        ? line.split('{emphasis}').map((part, partIndex) =>
                            partIndex === 0 ? (
                              part
                            ) : (
                              <span key={`emphasis-${index}-${partIndex}`}>
                                <strong>{copy.landingIntroSubtextEmphasis}</strong>
                                {part}
                              </span>
                            )
                          )
                        : line}
                    </span>
                  ))}
              </p>
              <div className="intro-cta">
                <a
                  className="primary landing-cta"
                  href="/login"
                  onClick={handleLandingCtaClick}
                >
                  {copy.landingCta}
                </a>
                <div className="landing-microcopy">
                  {copy.landingIntroCtaNoteLines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="landing-section before">
            <div className="landing-inner">
              <p className="before-lead">
                {copy.landingBeforeLead.split('\n').map((line, index) =>
                  index === 0 ? (
                    <span key="before-lead-primary">{line}</span>
                  ) : (
                    <span
                      key={`before-lead-${index}`}
                      className={`before-lead-secondary ${uiLanguage === 'Polish' ? 'before-lead-secondary-pl' : 'before-lead-secondary-en'}`.trim()}
                    >
                      {line}
                    </span>
                  )
                )}
              </p>
              <ul className="icon-list negative">
                {copy.landingBeforeList.map((item, index) =>
                  item.trim().length === 0 ? (
                    <li key={`spacer-${index}`} className="icon-list-spacer" aria-hidden="true" />
                  ) : (
                    <li
                      key={`${item}-${index}`}
                      className={item.trim().endsWith('?') ? 'before-final' : undefined}
                    >
                      {item}
                    </li>
                  )
                )}
              </ul>
              {(copy.landingBeforeEmphasis.strong ||
                copy.landingBeforeEmphasis.medium ||
                copy.landingBeforeEmphasis.rest) && (
                <div className="landing-emphasis">
                  <span className="emphasis-strong">{copy.landingBeforeEmphasis.strong}</span>{' '}
                  <span className="emphasis-medium">{copy.landingBeforeEmphasis.medium}</span>{' '}
                  {copy.landingBeforeEmphasis.rest}
                </div>
              )}
            </div>
          </div>

          <div className="landing-section after">
            <div className="landing-inner">
              <p className="before-lead">
                {copy.landingAfterLead.split('\n').map((line, index) =>
                  index === 0 ? (
                    <span key="after-lead-primary">{line}</span>
                  ) : (
                    <span key={`after-lead-${index}`} className="after-lead-secondary">
                      {line}
                    </span>
                  )
                )}
              </p>
              <ul className="icon-list positive">
                {copy.landingAfterList.map((item, index) =>
                  item.trim().length === 0 ? (
                    <li key={`after-spacer-${index}`} className="icon-list-spacer" aria-hidden="true" />
                  ) : (
                    <li
                      key={`${item}-${index}`}
                      className={
                        index === copy.landingAfterList.length - 1
                          ? 'after-final'
                          : item.trim().endsWith(':') || item.trim().startsWith('✅')
                            ? 'after-muted'
                            : undefined
                      }
                    >
                      {item}
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>

          <div className="landing-section how">
            <div className="landing-inner">
              <h3>{copy.landingHowTitle}</h3>
              {copy.landingHowSteps.length > 0 ? (
                <ol className="how-steps">
                  {copy.landingHowSteps.map((step) => (
                    <li key={step.title} className="how-step">
                      <div className="how-step-title">{step.title}</div>
                      <div className="how-step-body">
                        {step.lines.map((line) => (
                          <div key={`${step.title}-${line}`}>{line}</div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="how-lines">
                  {copy.landingHowLines.map((line, index) => (
                    <div key={`${line}-${index}`}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="landing-section why">
            <div className="landing-inner">
              <p className="before-lead why-lead">
                {copy.landingWhyLead.split('\n').map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </p>
              <div className="stacked-lines">
                <span className="stacked-brand">{copy.landingWhyLines[0]}</span>
                {copy.landingWhyLines.slice(1).map((item) => (
                  <span
                    key={item}
                    className={
                      uiLanguage === 'English' && (item === 'AI assists.' || item === 'Humans decide.')
                        ? 'stacked-line-shift-en'
                        : uiLanguage === 'Polish' && (item === 'AI pomaga.' || item === 'Człowiek decyduje.')
                          ? 'stacked-line-shift-pl'
                          : undefined
                    }
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="landing-section who">
            <div className="landing-inner">
              <h2>{copy.landingWhoTitle}</h2>
              <ul className="icon-list neutral">
                {copy.landingWhoList.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="landing-final">
                <p>{copy.landingFinalLines[0]}</p>
                <p className="final-shift">{copy.landingFinalLines[1]}</p>
                <a
                  className="primary landing-cta"
                  href="/login"
                  onClick={handleLandingCtaClick}
                >
                  {copy.landingCta}
                </a>
                <div className="landing-microcopy">
                  <span>{copy.landingCtaNote}</span>
                  {copy.landingIntroCtaNoteLines[1] && (
                    <span>{copy.landingIntroCtaNoteLines[1]}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

        </section>
      )}
      {showLanding && landingView === 'threeSteps' && (
        <section className="landing">
          <div className="landing-section hero in-view">
            <div className="landing-inner">
              <div className="three-steps-title">{copy.landingThreeStepsTitle}</div>
              <h1>{copy.landingHeroTitle}</h1>
              <p>{copy.landingHeroSubtitle}</p>
              <button type="button" className="ghost landing-back" onClick={openMainLanding}>
                {copy.landingBackToFull}
              </button>
            </div>
          </div>

          <div className="landing-section intro">
            <div className="landing-inner">
              <div className="intro-title">
                <span className="title-brand">{copy.landingIntroTitleLines[0]}</span>
                {copy.landingIntroTitleLines.slice(1).map((line) => (
                  <span key={line} className="title-line">
                    {line}
                  </span>
                ))}
              </div>
              <p className="intro-subtext">
                {copy.landingIntroSubtextLines
                  .filter((line) => line.trim().length > 0)
                  .map((line, index) => (
                    <span key={`intro-subtext-three-${index}`}>
                      {line.includes('{emphasis}')
                        ? line.split('{emphasis}').map((part, partIndex) =>
                            partIndex === 0 ? (
                              part
                            ) : (
                              <span key={`emphasis-three-${index}-${partIndex}`}>
                                <strong>{copy.landingIntroSubtextEmphasis}</strong>
                                {part}
                              </span>
                            )
                          )
                        : line}
                    </span>
                  ))}
              </p>
              <div className="intro-cta">
                <a
                  className="primary landing-cta"
                  href="/login"
                  onClick={handleLandingCtaClick}
                >
                  {copy.landingCta}
                </a>
                <div className="landing-microcopy">
                  {copy.landingIntroCtaNoteLines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="landing-section before">
            <div className="landing-inner">
              <p className="before-lead">
                {copy.landingBeforeLead.split('\n').map((line, index) =>
                  index === 0 ? (
                    <span key="before-lead-primary">{line}</span>
                  ) : (
                    <span key={`before-lead-${index}`} className="before-lead-secondary">
                      {line}
                    </span>
                  )
                )}
              </p>
              <ul className="icon-list negative">
                {copy.landingBeforeList.map((item, index) =>
                  item.trim().length === 0 ? (
                    <li key={`spacer-${index}`} className="icon-list-spacer" aria-hidden="true" />
                  ) : (
                    <li
                      key={`${item}-${index}`}
                      className={item.trim().endsWith('?') ? 'before-final' : undefined}
                    >
                      {item}
                    </li>
                  )
                )}
              </ul>
              {(copy.landingBeforeEmphasis.strong ||
                copy.landingBeforeEmphasis.medium ||
                copy.landingBeforeEmphasis.rest) && (
                <div className="landing-emphasis">
                  <span className="emphasis-strong">{copy.landingBeforeEmphasis.strong}</span>{' '}
                  <span className="emphasis-medium">{copy.landingBeforeEmphasis.medium}</span>{' '}
                  {copy.landingBeforeEmphasis.rest}
                </div>
              )}
            </div>
          </div>

          <div className="landing-section who">
            <div className="landing-inner">
              <h2>{copy.landingWhoTitle}</h2>
              <ul className="icon-list neutral">
                {copy.landingWhoList.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="landing-final">
                <p>{copy.landingFinalLines[0]}</p>
                <p className="final-shift">{copy.landingFinalLines[1]}</p>
                <a
                  className="primary landing-cta"
                  href="/login"
                  onClick={handleLandingCtaClick}
                >
                  {copy.landingCta}
                </a>
                <div className="landing-microcopy">{copy.landingCtaNote}</div>
              </div>
            </div>
          </div>

        </section>
      )}
    </>
  )
}
