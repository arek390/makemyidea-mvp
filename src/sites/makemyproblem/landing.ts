import type { HtmlPublicPageDefinition } from '../publicPages'
import { siteConfigs } from '../siteConfig'

export const makeMyProblemHomePage: HtmlPublicPageDefinition = {
  siteId: siteConfigs.makeMyProblem.id,
  pathname: '/',
  title: 'MakeMyProblem.Work - AI problem solving with an action plan',
  description:
    'MakeMyProblem.Work helps you clarify a problem through a short AI-guided conversation and turn it into focused next actions.',
  cta: {
    label: 'Start solving',
    href: siteConfigs.makeMyProblem.primaryAppRoute,
  },
  styles: `
    :root {
      color-scheme: light;
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f4ef;
      color: #16241d;
      font-synthesis: none;
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

    .page {
      width: min(100%, 1120px);
      margin: 0 auto;
      padding: 22px 20px 40px;
    }

    .topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 6px 0 34px;
    }

    .brand {
      margin: 0;
      color: #31483a;
      font-size: 0.88rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .topline-link {
      color: #395445;
      font-size: 0.92rem;
      font-weight: 700;
      text-decoration: none;
    }

    .hero {
      display: grid;
      gap: 28px;
      padding: 18px 0 46px;
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

    @media (min-width: 768px) {
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

    @media (prefers-reduced-motion: no-preference) {
      .cta {
        transition: transform 160ms ease, box-shadow 160ms ease;
      }

      .cta:hover {
        transform: translateY(-1px);
        box-shadow: 0 22px 48px rgba(23, 54, 36, 0.24);
      }
    }
  `,
  bodyHtml: `
    <div class="page">
      <header class="topline" aria-label="MakeMyProblem.Work">
        <p class="brand">MakeMyProblem.Work</p>
        <a class="topline-link" href="/engine_2">Open app</a>
      </header>

      <main>
        <section class="hero" aria-labelledby="hero-title">
          <div>
            <p class="eyebrow">AI problem solving</p>
            <h1 id="hero-title">From problem to action plan</h1>
            <p class="hero-copy">
              MakeMyProblem.Work helps you clarify a problem through a short AI-guided
              conversation, organize what matters and move toward concrete next actions.
            </p>
            <div class="cta-row">
              <a class="cta" href="/engine_2">Start solving</a>
              <p class="reassurance">Short conversation. No long briefing required.</p>
            </div>
          </div>
          <aside class="hero-aside" aria-label="What you get">
            <p class="reassurance">
              Built for moments when the situation is unclear, the tradeoffs are real and
              you need a practical way forward instead of a long generic answer.
            </p>
          </aside>
        </section>

        <section aria-labelledby="how-title">
          <h2 id="how-title">How it works</h2>
          <ul class="steps">
            <li>
              <strong>Describe the problem</strong>
              <span>Start with what you know, even if it is messy or incomplete.</span>
            </li>
            <li>
              <strong>Clarify what matters</strong>
              <span>The AI asks focused questions and helps surface missing information.</span>
            </li>
            <li>
              <strong>Get an actionable plan</strong>
              <span>Turn the conversation into structured next actions you can use.</span>
            </li>
          </ul>
        </section>

        <section aria-labelledby="conversation-title">
          <h2 id="conversation-title">What the conversation does</h2>
          <div class="conversation-grid">
            <div class="conversation-card">
              <p>It asks focused questions instead of producing a generic answer too early.</p>
            </div>
            <div class="conversation-card">
              <p>It looks for missing information, unclear assumptions and conflicting requirements.</p>
            </div>
            <div class="conversation-card">
              <p>It structures what is already known so the real decision becomes easier to see.</p>
            </div>
            <div class="conversation-card">
              <p>It leads toward concrete next actions for structured problem solving.</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="use-cases-title">
          <h2 id="use-cases-title">Problems it can help with</h2>
          <ul class="use-cases">
            <li>
              <strong>Technical or product issue</strong>
              <span>Clarify symptoms, constraints and likely next checks.</span>
            </li>
            <li>
              <strong>Project or process blocker</strong>
              <span>Separate facts, assumptions and coordination gaps.</span>
            </li>
            <li>
              <strong>Decision with tradeoffs</strong>
              <span>Compare conflicting requirements before choosing a path.</span>
            </li>
            <li>
              <strong>Unclear root cause</strong>
              <span>Map what is known before jumping to a solution.</span>
            </li>
          </ul>
        </section>

        <section class="final-cta" aria-labelledby="final-title">
          <h2 id="final-title">Start with the problem you have now</h2>
          <p>
            A few focused answers are enough to begin. MakeMyProblem.Work will help you
            clarify the situation and shape a practical action plan.
          </p>
          <a class="cta" href="/engine_2">Start solving</a>
        </section>
      </main>
    </div>
  `,
}
