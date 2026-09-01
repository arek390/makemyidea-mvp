import type { Language, Translations } from '../content/copy'

type TopupTier = 'S' | 'M' | 'L'
type TopupPaymentProvider = 'autopay' | 'stripe'

export type TopupPageProps = {
  copy: Translations
  engineNotice: { message: string; variant: 'success' | 'error' } | null
  formatTopupAmountValue: (amountMinor: number) => string
  handleTopupClick: (tier: TopupTier) => void | Promise<void>
  handleTopupReturn: () => void
  isDiagEnabled: boolean
  logoutInProgress: boolean
  setTopupDigitalServicesAccepted: (accepted: boolean) => void
  setTopupPaymentProvider: (provider: TopupPaymentProvider) => void
  setTopupTermsAccepted: (accepted: boolean) => void
  showSupabaseConfigError: boolean
  stripeTopupEnabled: boolean
  supabaseConfigBody: string
  supabaseConfigTitle: string
  supabaseEnvDiag: { hasUrl: boolean; hasAnon: boolean; urlLen: number; anonLen: number }
  supabaseInitError: string | null
  topupAmountL: number
  topupAmountM: number
  topupAmountS: number
  topupDigitalServicesAccepted: boolean
  topupLoadingTier: TopupTier | null
  topupPaymentProvider: TopupPaymentProvider
  topupTermsAccepted: boolean
  uiLanguage: Language
}

export function TopupPage({
  copy,
  engineNotice,
  formatTopupAmountValue,
  handleTopupClick,
  handleTopupReturn,
  isDiagEnabled,
  logoutInProgress,
  setTopupDigitalServicesAccepted,
  setTopupPaymentProvider,
  setTopupTermsAccepted,
  showSupabaseConfigError,
  stripeTopupEnabled,
  supabaseConfigBody,
  supabaseConfigTitle,
  supabaseEnvDiag,
  supabaseInitError,
  topupAmountL,
  topupAmountM,
  topupAmountS,
  topupDigitalServicesAccepted,
  topupLoadingTier,
  topupPaymentProvider,
  topupTermsAccepted,
  uiLanguage,
}: TopupPageProps) {
    if (showSupabaseConfigError) {
      return (
        <div className="app auth-screen">
          <section className="panel auth-panel">
            <h1>{supabaseConfigTitle}</h1>
            <p className="muted">{supabaseConfigBody}</p>
            {isDiagEnabled && (
              <div className="muted">
                <div>hasUrl: {supabaseEnvDiag.hasUrl ? 'true' : 'false'}</div>
                <div>hasAnon: {supabaseEnvDiag.hasAnon ? 'true' : 'false'}</div>
                <div>urlLen: {supabaseEnvDiag.urlLen}</div>
                <div>anonLen: {supabaseEnvDiag.anonLen}</div>
                <div>supabaseInitError: {supabaseInitError}</div>
              </div>
            )}
          </section>
        </div>
      )
    }
    const topupCopy = copy.topupConfig
    const topupCurrency = 'PLN' as const
	    const isTopupBusy = topupLoadingTier !== null
	    const isTopupTermsPending = !topupTermsAccepted || !topupDigitalServicesAccepted
	    const autopayLogoUrl = new URL('../../logo/Autopay_500.svg', import.meta.url).href
	    const stripeLogoUrl = new URL('../../logo/Stripe wordmark - Blurple.svg', import.meta.url).href
	    const topupServiceBalanceNote =
	      uiLanguage === 'Polish'
	        ? 'Doładowanie Salda Usługowego umożliwia korzystanie z odpłatnych funkcji MakeMyIdea.work. Saldo Usługowe jest przedpłatą na usługi cyfrowe dostępne wyłącznie w Serwisie. Nie jest tokenem, walutą wirtualną, pieniądzem elektronicznym ani instrumentem finansowym. Koszt użycia danej funkcji jest pokazany w aplikacji przed jej uruchomieniem.'
	        : 'Topping up the Service Balance enables the use of paid MakeMyIdea.work features. The Service Balance is a prepayment for digital services available exclusively in the Service. It is not a token, virtual currency, electronic money, or a financial instrument. The cost of using a given feature is shown in the application before it is launched.'
    if (typeof window !== 'undefined') {
      console.log('[TOPUP REAL COMPONENT LOADED]')
    }
    return (
      <div className="app auth-screen">
        <div className="topup-stack">
          <button
            type="button"
            className="topup-return-button"
            onClick={handleTopupReturn}
          >
            {copy.topupReturnLabel}
          </button>
          <img
            className="topup-logo"
            src={new URL('/logo/logo_makemyideawork_transp.png', import.meta.url).href}
            alt="MakeMyIdea.work"
          />
          <h1 className="topup-title">{copy.topupTitle}</h1>
          <div className="topup-terms">
            <input
              id="topup-terms"
              type="checkbox"
              checked={topupTermsAccepted}
              onChange={(event) => setTopupTermsAccepted(event.target.checked)}
            />
            {uiLanguage === 'Polish' ? (
              <span>
                <label htmlFor="topup-terms">Akceptuję </label>
                <a href="/termsandconditions">regulamin serwisu MakeMyIdea.work</a>
                <br />
                <label htmlFor="topup-terms">
                  i zamawiam Doładowanie Salda Usługowego u Usługodawcy prowadzącego Serwis w
                  ramach działalności nierejestrowanej.
                </label>
              </span>
            ) : (
              <span>
                <label htmlFor="topup-terms">I accept the </label>
                <a href="/termsandconditions">MakeMyIdea.work terms and conditions</a>
                <br />
                <label htmlFor="topup-terms">
                  and order the Service Balance Top-up from the Service Provider operating the
                  Service as part of unregistered business activity.
                </label>
              </span>
            )}
          </div>
          <div className="topup-terms">
            <input
              id="topup-digital-services"
              type="checkbox"
              checked={topupDigitalServicesAccepted}
              onChange={(event) => setTopupDigitalServicesAccepted(event.target.checked)}
            />
            {uiLanguage === 'Polish' ? (
              <label htmlFor="topup-digital-services">
                Żądam rozpoczęcia świadczenia Usług Cyfrowych przed upływem 14-dniowego terminu
                odstąpienia od umowy i przyjmuję do wiadomości, że po rozpoczęciu korzystania z
                odpłatnej Usługi Cyfrowej mogę utracić prawo odstąpienia od umowy w zakresie usługi
                już wykonanej lub części Salda Usługowego wykorzystanej na tę usługę.
              </label>
            ) : (
              <label htmlFor="topup-digital-services">
                I request that the provision of Digital Services begin before the end of the 14-day
                withdrawal period and acknowledge that, after I start using a paid Digital Service, I
                may lose the right to withdraw from the agreement with respect to the service already
                performed or the part of the Service Balance used for that service.
              </label>
            )}
          </div>
	          {engineNotice && !logoutInProgress ? (
	            <div
	              className={`engine-notice engine-notice--${engineNotice.variant} topup-notice`}
	              role={engineNotice.variant === 'error' ? 'alert' : 'status'}
	            >
	              {engineNotice.message}
	            </div>
	          ) : null}
	          {stripeTopupEnabled ? (
	            <div className="topup-payment-section">
	              <p className="topup-footer">
	                {uiLanguage === 'Polish' ? 'Wybierz metodę płatności.' : 'Choose a payment method.'}
	              </p>
	              <div className="topup-payment-methods" role="radiogroup" aria-label="Payment method">
	                <button
	                  type="button"
	                  className={`topup-payment-method${
	                    topupPaymentProvider === 'autopay' ? ' topup-payment-method--selected' : ''
	                  }`}
	                  role="radio"
	                  aria-checked={topupPaymentProvider === 'autopay'}
	                  disabled={isTopupBusy}
	                  onClick={() => setTopupPaymentProvider('autopay')}
	                >
	                  <span className="topup-payment-method__copy">
	                    <span className="topup-payment-method__name">Autopay</span>
	                    <span className="topup-payment-method__detail">
	                      {uiLanguage === 'Polish'
	                        ? 'Polska / BLIK / przelew bankowy'
	                        : 'Poland / BLIK / bank transfer'}
	                    </span>
	                  </span>
	                  <img className="topup-payment-method__logo" src={autopayLogoUrl} alt="Autopay" />
	                </button>
	                <button
	                  type="button"
	                  className={`topup-payment-method${
	                    topupPaymentProvider === 'stripe' ? ' topup-payment-method--selected' : ''
	                  }`}
	                  role="radio"
	                  aria-checked={topupPaymentProvider === 'stripe'}
	                  disabled={isTopupBusy}
	                  onClick={() => setTopupPaymentProvider('stripe')}
	                >
	                  <span className="topup-payment-method__copy">
	                    <span className="topup-payment-method__name">Stripe</span>
	                    <span className="topup-payment-method__detail">
	                      {uiLanguage === 'Polish'
	                        ? 'Międzynarodowa płatność kartą'
	                        : 'International card payment'}
	                    </span>
	                  </span>
	                  <img className="topup-payment-method__logo" src={stripeLogoUrl} alt="Stripe" />
	                </button>
	              </div>
	            </div>
	          ) : null}
	          <div className="topup-row">
            <section
              className={`panel auth-panel auth-panel--topup topup-panel${
                isTopupBusy ? ' topup-panel--disabled' : ''
              }${isTopupTermsPending ? ' topup-panel--terms-pending' : ''
              }${topupLoadingTier === 'S' ? ' topup-panel--loading' : ''}`}
              style={{ width: '240px', height: '480px', maxWidth: '90vw', maxHeight: '90vh' }}
              role="button"
              tabIndex={0}
              aria-disabled={isTopupBusy || isTopupTermsPending}
              aria-busy={topupLoadingTier === 'S'}
              onClick={() => {
                console.log('[TOPUP REAL CLICK] S')
                console.log('[TOPUP RAW CLICK] S')
                void handleTopupClick('S')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  console.log('[TOPUP REAL CLICK] S')
                  console.log('[TOPUP RAW CLICK] S')
                  void handleTopupClick('S')
                }
              }}
            >
              <div className="topup-inner">
                <div className="topup-amount">
	                  <span className="topup-amount-value">
	                    {topupLoadingTier === 'S'
	                      ? '...'
	                      : formatTopupAmountValue(topupAmountS)}
	                  </span>
	                  <span className="topup-amount-currency">{topupCurrency}</span>
	                </div>
                <p className="topup-caption">
                  {topupCopy.captions[0][0]}
                  <br />
                  {topupCopy.captions[0][1]}
                </p>
                <div className="topup-letter-wrap">
                  <div className="topup-letter">S</div>
                </div>
                {copy.topupSubtitle ? (
                  <p className="muted auth-subtitle">{copy.topupSubtitle}</p>
                ) : null}
              </div>
            </section>
            <section
              className={`panel auth-panel auth-panel--topup auth-panel--topup-m topup-panel${
                isTopupBusy ? ' topup-panel--disabled' : ''
              }${isTopupTermsPending ? ' topup-panel--terms-pending' : ''
              }${topupLoadingTier === 'M' ? ' topup-panel--loading' : ''}`}
              style={{ width: '240px', height: '480px', maxWidth: '90vw', maxHeight: '90vh' }}
              role="button"
              tabIndex={0}
              aria-disabled={isTopupBusy || isTopupTermsPending}
              aria-busy={topupLoadingTier === 'M'}
              onClick={() => {
                console.log('[TOPUP REAL CLICK] M')
                void handleTopupClick('M')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  console.log('[TOPUP REAL CLICK] M')
                  void handleTopupClick('M')
                }
              }}
            >
              <div className="topup-inner">
                <div className="topup-amount">
	                  <span className="topup-amount-value">
	                    {topupLoadingTier === 'M'
	                      ? '...'
	                      : formatTopupAmountValue(topupAmountM)}
	                  </span>
	                  <span className="topup-amount-currency">{topupCurrency}</span>
	                </div>
                <p className="topup-caption">
                  {topupCopy.captions[1][0]}
                  <br />
                  {topupCopy.captions[1][1]}
                </p>
                <div className="topup-letter-wrap">
                  <div className="topup-letter">M</div>
                </div>
                {copy.topupSubtitle ? (
                  <p className="muted auth-subtitle">{copy.topupSubtitle}</p>
                ) : null}
              </div>
            </section>
            <section
              className={`panel auth-panel auth-panel--topup topup-panel${
                isTopupBusy ? ' topup-panel--disabled' : ''
              }${isTopupTermsPending ? ' topup-panel--terms-pending' : ''
              }${topupLoadingTier === 'L' ? ' topup-panel--loading' : ''}`}
              style={{ width: '240px', height: '480px', maxWidth: '90vw', maxHeight: '90vh' }}
              role="button"
              tabIndex={0}
              aria-disabled={isTopupBusy || isTopupTermsPending}
              aria-busy={topupLoadingTier === 'L'}
              onClick={() => {
                console.log('[TOPUP REAL CLICK] L')
                void handleTopupClick('L')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  console.log('[TOPUP REAL CLICK] L')
                  void handleTopupClick('L')
                }
              }}
            >
              <div className="topup-inner">
                <div className="topup-amount">
	                  <span className="topup-amount-value">
	                    {topupLoadingTier === 'L'
	                      ? '...'
	                      : formatTopupAmountValue(topupAmountL)}
	                  </span>
	                  <span className="topup-amount-currency">{topupCurrency}</span>
	                </div>
                <p className="topup-caption">
                  {topupCopy.captions[2][0]}
                  <br />
                  {topupCopy.captions[2][1]}
                </p>
                <div className="topup-letter-wrap">
                  <div className="topup-letter">L</div>
                </div>
                {copy.topupSubtitle ? (
                  <p className="muted auth-subtitle">{copy.topupSubtitle}</p>
                ) : null}
              </div>
            </section>
          </div>
	          <p className="topup-footer">
	            {topupCopy.footer}
	          </p>
	          <p className="topup-footer topup-footer--service-balance">
	            {topupServiceBalanceNote}
	          </p>
	          {uiLanguage === 'English' && (
	            <p className="muted topup-footer">All payments and service balances are processed in PLN.</p>
	          )}
	        </div>
	      </div>
	    )
}
