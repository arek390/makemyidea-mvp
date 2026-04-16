import { useEffect, useMemo, useRef, useState } from 'react'
import { reportCopy, type ReportLang } from './reportI18n'
import { downloadReportCsv, type ReportSnapshot } from './exportCsv'
import {
  ENGINE_ENTRY_LABELS,
  ENGINE_ENTRY_LABEL_COLORS,
  getEntryLabelText,
  getNoLabelText,
} from '../engine/entryLabels'
import type {
  ReportExecutionReport,
  ReportRecommendations,
  ReportTrizSection,
  ReportTrizSolution,
  ReportTrizSolutionImage,
} from '../storage/sessionStore'
import { UsageBadge } from '../components/UsageBadge'
import { buildSessionGoalText, extractProductNameFromSessionName } from './sessionGoal'
import { fetchReportBySessionId, updateReportBySessionId } from '../lib/cloudReports'
import { supabase as client } from '../lib/supabase/client'
import { AiCostButton } from '../components/AiCostButton'
 
const TOPUP_RETURN_TO_KEY = 'topup-return-to'

const withAlpha = (hexColor: string, alphaHex = '66') => {
  const value = String(hexColor || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(value) ? `${value}${alphaHex}` : value
}

type ReportPageProps = {
  snapshot: ReportSnapshot
  language: ReportLang
  onBack: () => void
  onLogout: () => void
  onSaveSession?: () => void
  saveSessionLabel?: string
  userId?: string | null
  aiSupportEnabled: boolean
  diagnosticsEnabled: boolean
  canToggleDiagnostics?: boolean
  diagnosticsToggleLabel?: string
  onToggleDiagnostics?: () => void
  diagnosticsAuthLabel?: string | null
  canToggleAiSupport?: boolean
  aiSupportToggleLabel?: string
  onToggleAiSupport?: () => void
  llmUsageIndicatorLabel?: string
  llmUsageValue?: string | null
  llmUsageClassName?: string
  sessionUsageDiagnostics?: {
    sessionId: string | null
    summaryQueryStatus: 'idle' | 'running' | 'ok' | 'error'
    eventsQueryStatus: 'idle' | 'running' | 'ok' | 'error'
    realtimeStatus: string | null
    summaryError: { code: string | null; message: string; details: string | null; hint: string | null } | null
    eventsError: { code: string | null; message: string; details: string | null; hint: string | null } | null
    lastCheckedAt: number | null
  } | null
  llmCostLines?: string[]
  llmCostBreakdownLabel?: string
  llmCostBreakdownRows?: string[]
  naFillStatus?: 'idle' | 'running' | 'done' | 'error'
  onAiUsage?: (meta: unknown) => void
  onReportMetaChange?: (meta: {
    summary?: AiSummary | null
    lastSummaryTextHash?: string | null
    createdAt?: number | null
    updatedAt?: number | null
    ideas?: ReportSnapshot['ideas'] | null
    recommendations?: ReportRecommendations | null
    triz?: ReportTrizSection | null
    execution_report?: ReportExecutionReport | null
  }) => void
  onUpdateLabel?: (itemId: string, label: string | null) => Promise<boolean>
  onBillingInsufficient?: () => void
  onBillingRefresh?: () => void
  billingCurrency?: 'PLN' | 'USD'
  balanceMinor?: number
  billingLoading?: boolean
  billingError?: string | null
  showInsufficientBalance?: boolean
  insufficientBalanceNotice?: string
}

type AiSummary = {
  headline: string
  narrative: string
  today: string
  change: string
  product: string
}

const normalizeExecutionReport = (value: unknown): ReportExecutionReport => {
  const empty: ReportExecutionReport = {
    stage: null,
    headline: '',
    goal: '',
    map_context: {
      coverage_summary: '',
      strongest_area: null,
      weakest_area: null,
      decision_risk_note: null,
    },
    priorities: [],
    action_plan: [],
    decisions: [],
    validation_loop: [],
    next_session_focus: '',
    supporting_items: [],
    source_snapshot: null,
  }
  if (!value || typeof value !== 'object') return empty
  const report = value as Record<string, unknown>
  const toText = (input: unknown) => (typeof input === 'string' ? input.trim() : '')
  const toSelectedOption = (input: unknown): 'a' | 'b' | null =>
    input === 'a' || input === 'b' ? input : null
  const toContradictionIndex = (input: unknown): number | null => {
    const raw = typeof input === 'number' ? input : typeof input === 'string' ? Number(input) : NaN
    return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : null
  }
  const stage = (() => {
    const raw = toText(report.stage)
    if (raw === 'awaiting_decisions' || raw === 'plan_generated') return raw
    const hasPlan =
      (Array.isArray(report.priorities) && report.priorities.length > 0) ||
      (Array.isArray(report.action_plan) && report.action_plan.length > 0) ||
      (Array.isArray(report.validation_loop) && report.validation_loop.length > 0) ||
      Boolean(toText(report.next_session_focus))
    return hasPlan ? 'plan_generated' : 'awaiting_decisions'
  })()
  return {
    stage,
    headline: toText(report.headline),
    goal: toText(report.goal),
    map_context:
      report.map_context && typeof report.map_context === 'object'
        ? {
            coverage_summary: toText((report.map_context as Record<string, unknown>).coverage_summary),
            strongest_area: toText((report.map_context as Record<string, unknown>).strongest_area) || null,
            weakest_area: toText((report.map_context as Record<string, unknown>).weakest_area) || null,
            decision_risk_note:
              toText((report.map_context as Record<string, unknown>).decision_risk_note) || null,
          }
        : empty.map_context,
    priorities: Array.isArray(report.priorities)
      ? report.priorities
          .filter((item) => item && typeof item === 'object')
          .map((item) => {
            const current = item as Record<string, unknown>
            return {
              title: toText(current.title),
              why_it_matters: toText(current.why_it_matters),
              impact:
                current.impact === 'high' || current.impact === 'medium' || current.impact === 'low'
                  ? current.impact
                  : 'medium',
              risk_of_ignoring: toText(current.risk_of_ignoring),
            }
          })
          .filter((item) => item.title || item.why_it_matters || item.risk_of_ignoring)
      : [],
    action_plan: Array.isArray(report.action_plan)
      ? report.action_plan
          .filter((item) => item && typeof item === 'object')
          .map((item) => {
            const current = item as Record<string, unknown>
            const sourceTypeRaw = toText(current.source_type)
            const source_type =
              sourceTypeRaw === 'decision' || sourceTypeRaw === 'triz' || sourceTypeRaw === 'analysis'
                ? (sourceTypeRaw as 'decision' | 'triz' | 'analysis')
                : null
            const source_ref = toText(current.source_ref) || null
            const derived_from_user_choice =
              typeof current.derived_from_user_choice === 'boolean'
                ? current.derived_from_user_choice
                : null
            return {
              title: toText(current.title),
              what_to_do: toText(current.what_to_do),
              why_now: toText(current.why_now),
              expected_result: toText(current.expected_result),
              ...(source_type ? { source_type } : {}),
              ...(source_ref ? { source_ref } : {}),
              ...(derived_from_user_choice != null ? { derived_from_user_choice } : {}),
            }
          })
          .filter((item) => item.title || item.what_to_do || item.why_now || item.expected_result)
      : [],
    decisions: Array.isArray(report.decisions)
      ? report.decisions
          .filter((item) => item && typeof item === 'object')
          .map((item) => {
            const current = item as Record<string, unknown>
            return {
              contradiction_index: toContradictionIndex(current.contradiction_index ?? current.contradictionIndex),
              tradeoff: toText(current.tradeoff),
              option_a: toText(current.option_a),
              option_b: toText(current.option_b),
              consequence_a: toText(current.consequence_a),
              consequence_b: toText(current.consequence_b),
              choose_a_when: toText(current.choose_a_when),
              choose_b_when: toText(current.choose_b_when),
              selected_option: toSelectedOption(current.selected_option),
            }
          })
          .filter(
            (item) =>
              item.tradeoff ||
              item.option_a ||
              item.option_b ||
              item.consequence_a ||
              item.consequence_b
          )
      : [],
    validation_loop: Array.isArray(report.validation_loop)
      ? report.validation_loop
          .filter((item) => item && typeof item === 'object')
          .map((item) => {
            const current = item as Record<string, unknown>
            return {
              check: toText(current.check),
              how_to_check: toText(current.how_to_check),
              positive_result_means: toText(current.positive_result_means),
              negative_result_means: toText(current.negative_result_means),
            }
          })
          .filter(
            (item) =>
              item.check || item.how_to_check || item.positive_result_means || item.negative_result_means
          )
      : [],
    next_session_focus: toText(report.next_session_focus),
    supporting_items: Array.isArray(report.supporting_items)
      ? (report.supporting_items as ReportSnapshot['ideas'])
      : [],
    source_snapshot:
      report.source_snapshot && typeof report.source_snapshot === 'object'
        ? (report.source_snapshot as ReportExecutionReport['source_snapshot'])
        : null,
  }
}

const mergeExecutionDecisionSelections = (
  incoming: ReportExecutionReport | null,
  fallback: ReportExecutionReport | null
): ReportExecutionReport | null => {
  if (!incoming) return fallback
  if ((!incoming.decisions || incoming.decisions.length === 0) && fallback?.decisions?.length) {
    return { ...incoming, decisions: fallback.decisions }
  }
  if (!fallback?.decisions?.length) return incoming
  const fallbackByTradeoff = new Map(
    fallback.decisions.map((item, index) => [sanitizeReportText(item.tradeoff || '') || `idx:${index}`, item])
  )
  return {
    ...incoming,
    decisions: incoming.decisions.map((item, index) => {
      if (item.selected_option === 'a' || item.selected_option === 'b') return item
      const fallbackItem =
        fallbackByTradeoff.get(sanitizeReportText(item.tradeoff || '') || `idx:${index}`) ||
        fallback.decisions[index] ||
        null
      if (!fallbackItem?.selected_option) return item
      return {
        ...item,
        selected_option: fallbackItem.selected_option,
      }
    }),
  }
}

const sanitizeReportText = (input: string) => {
  let value = String(input ?? '')
  const matrixCodeGroup = String.raw`(?:[ABC][123]\s*(?:,\s*[ABC][123]\s*)*)`
  value = value.replace(new RegExp(String.raw`\s*\(\s*${matrixCodeGroup}\)\s*[.;:!?]`, 'g'), '')
  value = value.replace(new RegExp(String.raw`\s*\(\s*${matrixCodeGroup}\)\s*`, 'g'), ' ')
  value = value.replace(
    /(^|[\s\u00A0])([ABC][123])(?=([\s\u00A0]*[.,;:!?)]|[\s\u00A0]*$))/g,
    '$1'
  )
  value = value.replace(/\(\s*\)/g, '')
  value = value.replace(/\s+/g, ' ').replace(/\s+([.,;:!?\)])/g, '$1').trim()
  return value
}

const ACTION_PLAN_PLACEHOLDER_PATTERNS = [
  /this priority affects the next product decisions around/i,
  /if ignored, the team may keep moving without clarity around/i,
  /define a small test or observation to verify/i,
  /the current direction gains support and can move forward/i,
  /the direction should be adjusted before more effort is invested/i,
  /prefer the simpler or lower-risk path/i,
  /prefer the more ambitious or higher-upside path/i,
  /choose the safer path when/i,
  /choose the bolder path when/i,
]

const sanitizeActionPlanDetail = (input: string | null | undefined) => {
  const value = sanitizeReportText(String(input || ''))
  if (!value) return ''
  return ACTION_PLAN_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value)) ? '' : value
}

const hasLeanExecutionReportContent = (report: ReportExecutionReport | null) => {
  if (!report) return false
  const sectionsWithContent = [
    Array.isArray(report.priorities) && report.priorities.some((item) => sanitizeActionPlanDetail(item.title)),
    Array.isArray(report.action_plan) && report.action_plan.some((item) => sanitizeActionPlanDetail(item.title)),
    Array.isArray(report.decisions) && report.decisions.some((item) => sanitizeActionPlanDetail(item.tradeoff)),
    Array.isArray(report.validation_loop) && report.validation_loop.some((item) => sanitizeActionPlanDetail(item.check)),
  ].filter(Boolean).length
  return Boolean(
    sanitizeActionPlanDetail(report.goal) &&
      sanitizeActionPlanDetail(report.map_context?.coverage_summary || '') &&
      sectionsWithContent >= 2
  )
}

const renderInlineMarkdown = (input: string) => {
  const value = String(input || '')
  if (!value.includes('**')) return value
  const parts = value.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`md-${index}`}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}

const sanitizeReportPayload = <T,>(payload: T): T => {
  if (payload == null) return payload
  if (typeof payload === 'string') return sanitizeReportText(payload) as T
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeReportPayload(item)) as T
  }
  if (typeof payload === 'object') {
    const next: Record<string, unknown> = {}
    Object.entries(payload as Record<string, unknown>).forEach(([key, value]) => {
      next[key] = sanitizeReportPayload(value)
    })
    return next as T
  }
  return payload
}

const RefreshIndicatorIcon = ({
  variant,
  className = '',
}: {
  variant: 'suggestion' | 'loading'
  className?: string
}) => (
  <span
    className={`report-refresh-icon report-refresh-icon--${variant}${className ? ` ${className}` : ''}`}
    aria-hidden="true"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15.13-6.13L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15.13 6.13L3 16" />
    </svg>
  </span>
)

const sanitizeFilenamePart = (value: string) => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[\/\\:\*\?"<>|]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'report'
}

const formatDate = (value?: number | null) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10)
    }
  }
  return new Date().toISOString().slice(0, 10)
}

const validateAndNormalizeReport = (payload: unknown) => {
  const empty = {
    summary: { headline: '', narrative: '', today: '', change: '', product: '' },
    ideas: [] as ReportSnapshot['ideas'],
    recommendations: {
      based_on_user_ideas: [],
      morphological: [],
      market_trends: [],
    } as ReportRecommendations,
    triz: {
      section_title: '',
      section_intro: '',
      contradictions: [],
    } as ReportTrizSection,
    execution_report: normalizeExecutionReport(null),
    source_snapshot: null as unknown,
  }
  if (!payload || typeof payload !== 'object') {
    return { ...empty }
  }
  const value = payload as {
    summary?: unknown
    ideas?: unknown
    recommendations?: unknown
    triz?: unknown
    execution_report?: unknown
    source_snapshot?: unknown
    headline?: unknown
    narrative?: unknown
    today?: unknown
    change?: unknown
    product?: unknown
  }
  let summary = empty.summary
  if (value.summary && typeof value.summary === 'object') {
    const s = value.summary as {
      headline?: unknown
      narrative?: unknown
      today?: unknown
      change?: unknown
      product?: unknown
    }
    summary = {
      headline: typeof s.headline === 'string' ? s.headline : '',
      narrative: typeof s.narrative === 'string' ? s.narrative : '',
      today: typeof s.today === 'string' ? s.today : '',
      change: typeof s.change === 'string' ? s.change : '',
      product: typeof s.product === 'string' ? s.product : '',
    }
  } else if (
    typeof value.headline === 'string' ||
    typeof value.narrative === 'string' ||
    typeof value.today === 'string' ||
    typeof value.change === 'string' ||
    typeof value.product === 'string'
  ) {
    summary = {
      headline: typeof value.headline === 'string' ? value.headline : '',
      narrative: typeof value.narrative === 'string' ? value.narrative : '',
      today: typeof value.today === 'string' ? value.today : '',
      change: typeof value.change === 'string' ? value.change : '',
      product: typeof value.product === 'string' ? value.product : '',
    }
  }
  const ideas = Array.isArray(value.ideas) ? (value.ideas as ReportSnapshot['ideas']) : []
  const recommendations = normalizeRecommendations(value.recommendations)
  const triz = normalizeTriz(value.triz)
  const execution_report = normalizeExecutionReport(value.execution_report)
  return {
    summary,
    ideas,
    recommendations,
    triz,
    execution_report,
    source_snapshot: value.source_snapshot ?? null,
  }
}

const isRecommendationItem = (value: unknown) => {
  if (!value || typeof value !== 'object') return false
  const item = value as {
    title?: unknown
    rationale?: unknown
    how_to_test?: unknown
    methods?: unknown
    confidence?: unknown
  }
  if (typeof item.title !== 'string') return false
  if (typeof item.rationale !== 'string') return false
  if (typeof item.how_to_test !== 'string') return false
  if (item.methods && !Array.isArray(item.methods)) return false
  if (
    item.confidence &&
    item.confidence !== 'low' &&
    item.confidence !== 'med' &&
    item.confidence !== 'high'
  ) {
    return false
  }
  return true
}

const normalizeRecommendations = (value: unknown): ReportRecommendations => {
  const empty: ReportRecommendations = {
    based_on_user_ideas: [],
    morphological: [],
    market_trends: [],
  }
  if (!value || typeof value !== 'object') return { ...empty }
  const rec = value as {
    based_on_user_ideas?: unknown
    morphological?: unknown
    market_trends?: unknown
  }
  const based = Array.isArray(rec.based_on_user_ideas)
    ? rec.based_on_user_ideas.filter(isRecommendationItem)
    : []
  const morph = Array.isArray(rec.morphological)
    ? rec.morphological.filter(isRecommendationItem)
    : []
  const trends = Array.isArray(rec.market_trends)
    ? rec.market_trends.filter(isRecommendationItem)
    : []
  return {
    based_on_user_ideas: based,
    morphological: morph,
    market_trends: trends,
  }
}

const isTrizPrinciple = (
  value: unknown
): value is NonNullable<ReportTrizSection['contradictions'][number]>['principles'][number] => {
  if (!value || typeof value !== 'object') return false
  const item = value as {
    id?: unknown
    name?: unknown
    rationale?: unknown
    how_to_apply?: unknown
  }
  if (typeof item.name !== 'string' || item.name.trim().length === 0) return false
  if (item.id != null && !Number.isFinite(Number(item.id))) return false
  if (item.rationale != null && typeof item.rationale !== 'string') return false
  if (item.how_to_apply != null && typeof item.how_to_apply !== 'string') return false
  return true
}

const normalizeTrizSolutionImage = (value: unknown): ReportTrizSolutionImage | null => {
  if (!value || typeof value !== 'object') return null
  const image = value as {
    status?: unknown
    storage_path?: unknown
    public_url?: unknown
    mime_type?: unknown
    file_name?: unknown
    generated_at?: unknown
    prompt?: unknown
    error_message?: unknown
  }
  const status =
    image.status === 'idle' || image.status === 'ready' || image.status === 'failed'
      ? image.status
      : undefined
  const storagePath =
    typeof image.storage_path === 'string' && image.storage_path.trim()
      ? image.storage_path.trim()
      : undefined
  const publicUrl =
    typeof image.public_url === 'string' && image.public_url.trim()
      ? image.public_url.trim()
      : undefined
  const mimeType =
    typeof image.mime_type === 'string' && image.mime_type.trim()
      ? image.mime_type.trim()
      : undefined
  const fileName =
    typeof image.file_name === 'string' && image.file_name.trim()
      ? image.file_name.trim()
      : undefined
  const generatedAt =
    typeof image.generated_at === 'string' && image.generated_at.trim()
      ? image.generated_at.trim()
      : undefined
  const prompt =
    typeof image.prompt === 'string' && image.prompt.trim() ? image.prompt.trim() : undefined
  const errorMessage =
    typeof image.error_message === 'string' && image.error_message.trim()
      ? image.error_message.trim()
      : undefined
  if (
    !status &&
    !storagePath &&
    !publicUrl &&
    !mimeType &&
    !fileName &&
    !generatedAt &&
    !prompt &&
    !errorMessage
  ) {
    return null
  }
  return {
    ...(status ? { status } : {}),
    ...(storagePath ? { storage_path: storagePath } : {}),
    ...(publicUrl ? { public_url: publicUrl } : {}),
    ...(mimeType ? { mime_type: mimeType } : {}),
    ...(fileName ? { file_name: fileName } : {}),
    ...(generatedAt ? { generated_at: generatedAt } : {}),
    ...(prompt ? { prompt } : {}),
    ...(errorMessage ? { error_message: errorMessage } : {}),
  }
}

const normalizeTrizSolutionImages = (value: unknown): ReportTrizSolutionImage[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeTrizSolutionImage(item))
    .filter((item): item is ReportTrizSolutionImage => Boolean(item))
}

const normalizeTrizSolution = (value: unknown): ReportTrizSolution | null => {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null
    return {
      title: text,
      description: '',
    }
  }
  if (!value || typeof value !== 'object') return null
  const solution = value as {
    title?: unknown
    description?: unknown
    sketch_prompt?: unknown
    image?: unknown
  }
  const title = typeof solution.title === 'string' ? solution.title.trim() : ''
  const description = typeof solution.description === 'string' ? solution.description.trim() : ''
  const sketchPrompt =
    typeof solution.sketch_prompt === 'string' && solution.sketch_prompt.trim()
      ? solution.sketch_prompt.trim()
      : undefined
  const image = normalizeTrizSolutionImage(solution.image)
  const images = normalizeTrizSolutionImages((solution as { images?: unknown }).images)
  const mergedImages = (() => {
    if (image && images.some((item) => item.storage_path && item.storage_path === image.storage_path)) {
      return images
    }
    if (image) return [image, ...images]
    return images
  })()
  if (!title && !description) return null
  return {
    title: title || description,
    description,
    ...(sketchPrompt ? { sketch_prompt: sketchPrompt } : {}),
    ...(image ? { image } : {}),
    ...(mergedImages.length ? { images: mergedImages } : {}),
  }
}

const normalizeTriz = (value: unknown): ReportTrizSection => {
  const empty: ReportTrizSection = {
    section_title: '',
    section_intro: '',
    contradictions: [],
  }
  if (!value || typeof value !== 'object') return { ...empty }
  const section = value as {
    section_title?: unknown
    section_intro?: unknown
    contradictions?: unknown
  }
  const contradictions = Array.isArray(section.contradictions)
    ? section.contradictions
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const contradiction = item as {
            title?: unknown
            explanation?: unknown
            solution_directions?: unknown
            approaches?: unknown
            selected_approach_indices?: unknown
            selected_approach_titles?: unknown
            selected_approach_index?: unknown
            selected_approach_title?: unknown
            reflections?: unknown
            description?: unknown
            improving?: unknown
            worsening?: unknown
            principles?: unknown
            solutions?: unknown
          }
          const title = typeof contradiction.title === 'string' ? contradiction.title.trim() : ''
          const explanation =
            typeof contradiction.explanation === 'string' ? contradiction.explanation.trim() : ''
          const description =
            typeof contradiction.description === 'string' ? contradiction.description.trim() : ''
          const improving =
            typeof contradiction.improving === 'string' ? contradiction.improving.trim() : ''
          const worsening =
            typeof contradiction.worsening === 'string' ? contradiction.worsening.trim() : ''
          const solutionDirections = Array.isArray(contradiction.solution_directions)
            ? contradiction.solution_directions
                .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
                .map((entry) => entry.trim())
                .slice(0, 4)
            : []
          const principles = Array.isArray(contradiction.principles)
            ? contradiction.principles
                .filter(isTrizPrinciple)
                .map((principle) => ({
                  ...(principle.id != null ? { id: Number(principle.id) } : {}),
                  name: principle.name.trim(),
                  ...(typeof principle.rationale === 'string' && principle.rationale.trim()
                    ? { rationale: principle.rationale.trim() }
                    : {}),
                  ...(typeof principle.how_to_apply === 'string' && principle.how_to_apply.trim()
                    ? { how_to_apply: principle.how_to_apply.trim() }
                    : {}),
                }))
            : []
          const approaches = Array.isArray(contradiction.approaches)
            ? contradiction.approaches
                .map((approach) => normalizeTrizSolution(approach))
                .filter((approach): approach is ReportTrizSolution => Boolean(approach))
                .slice(0, 4)
            : []
          const solutions = Array.isArray(contradiction.solutions)
            ? contradiction.solutions
                .map((solution) => normalizeTrizSolution(solution))
                .filter((solution): solution is ReportTrizSolution => Boolean(solution))
            : approaches
          const reflections = Array.isArray(contradiction.reflections)
            ? contradiction.reflections
                .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
                .map((entry) => entry.trim())
                .slice(0, 3)
            : []
          const hasNewShape = Boolean(title && explanation)
          const hasOldShape = Boolean(title && description && improving && worsening)
          if (!hasNewShape && !hasOldShape) return null
          const renderedApproaches = approaches.length ? approaches : solutions
          const selectedIndicesRaw = Array.isArray(contradiction.selected_approach_indices)
            ? contradiction.selected_approach_indices
            : []
          const selectedIndicesFromLegacy = (() => {
            const legacyRaw =
              typeof contradiction.selected_approach_index === 'number'
                ? contradiction.selected_approach_index
                : typeof contradiction.selected_approach_index === 'string'
                  ? Number(contradiction.selected_approach_index)
                  : NaN
            return Number.isFinite(legacyRaw) ? [Math.max(0, Math.floor(legacyRaw))] : []
          })()
          const selectedIndices = Array.from(
            new Set(
              [...selectedIndicesRaw, ...selectedIndicesFromLegacy]
                .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
                .filter((entry) => Number.isFinite(entry))
                .map((entry) => Math.max(0, Math.floor(entry)))
                .filter((entry) => entry >= 0 && entry < renderedApproaches.length)
            )
          )
          const selectedTitlesRaw = Array.isArray(contradiction.selected_approach_titles)
            ? contradiction.selected_approach_titles
            : []
          const selectedTitleLegacy =
            typeof contradiction.selected_approach_title === 'string' &&
            contradiction.selected_approach_title.trim()
              ? [contradiction.selected_approach_title.trim()]
              : []
          const selectedTitles = Array.from(
            new Set(
              [...selectedTitlesRaw, ...selectedTitleLegacy]
                .filter((entry): entry is string => typeof entry === 'string')
                .map((entry) => entry.trim())
                .filter(Boolean)
            )
          )
          return {
            title,
            ...(explanation ? { explanation } : {}),
            ...(solutionDirections.length ? { solution_directions: solutionDirections } : {}),
            ...(approaches.length ? { approaches } : {}),
            ...(selectedIndices.length ? { selected_approach_indices: selectedIndices } : {}),
            ...(selectedTitles.length ? { selected_approach_titles: selectedTitles } : {}),
            ...(reflections.length ? { reflections } : {}),
            ...(description ? { description } : {}),
            ...(improving ? { improving } : {}),
            ...(worsening ? { worsening } : {}),
            principles,
            solutions,
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 3)
    : []
  return {
    section_title: typeof section.section_title === 'string' ? section.section_title.trim() : '',
    section_intro: typeof section.section_intro === 'string' ? section.section_intro.trim() : '',
    contradictions,
  }
}
type SummaryUsage = {
  model: string | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  fxUsdPln: number
  costPln: number
}

export const ReportPage = ({
  snapshot,
  language,
  onBack,
  aiSupportEnabled,
  diagnosticsEnabled,
  canToggleDiagnostics = false,
  diagnosticsToggleLabel,
  onToggleDiagnostics,
  diagnosticsAuthLabel = null,
  canToggleAiSupport = false,
  aiSupportToggleLabel,
  onToggleAiSupport,
  llmUsageIndicatorLabel,
  llmUsageValue = null,
  llmUsageClassName = '',
  sessionUsageDiagnostics = null,
  llmCostLines = [],
  llmCostBreakdownLabel,
  llmCostBreakdownRows = [],
  naFillStatus,
  onAiUsage,
  onUpdateLabel,
  onReportMetaChange,
  onBillingInsufficient,
  onBillingRefresh,
  onSaveSession,
  saveSessionLabel,
  billingCurrency = 'PLN',
  balanceMinor = 0,
  billingLoading = false,
  billingError = null,
  showInsufficientBalance = false,
  insufficientBalanceNotice = 'Insufficient funds. Top up your account.',
}: ReportPageProps) => {
  const t = reportCopy[language]
  const reportLogoUrl = new URL('../../logo/logo_makemyideawork.png', import.meta.url).href
  const reportMetaRef = useRef<any>(snapshot.reportMeta ?? null)
  const initialReport = validateAndNormalizeReport({
    summary: snapshot.reportMeta?.summary ?? null,
    ideas: snapshot.ideas ?? null,
    recommendations: snapshot.reportMeta?.recommendations ?? null,
    triz: snapshot.reportMeta?.triz ?? null,
    execution_report: snapshot.reportMeta?.execution_report ?? null,
  })
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(
    sanitizeReportPayload(initialReport.summary)
  )
  const [summaryStatus, setSummaryStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [lastSummaryTextHash, setLastSummaryTextHash] = useState<string | null>(
    snapshot.reportMeta?.lastSummaryTextHash ?? null
  )
  // IMPORTANT: "Zebrane pomysły i obserwacje" is live data, not report snapshot.
  const [summaryItems, setSummaryItems] = useState<ReportSnapshot['ideas']>(
    sanitizeReportPayload(snapshot.ideas)
  )
  const [reportRecommendations, setReportRecommendations] = useState<ReportRecommendations>(
    normalizeRecommendations(sanitizeReportPayload(initialReport.recommendations))
  )
  const [reportTriz, setReportTriz] = useState<ReportTrizSection | null>(
    snapshot.reportMeta?.triz ? normalizeTriz(sanitizeReportPayload(snapshot.reportMeta.triz)) : null
  )
  const [executionReport, setExecutionReport] = useState<ReportExecutionReport | null>(
    snapshot.reportMeta?.execution_report
      ? normalizeExecutionReport(sanitizeReportPayload(snapshot.reportMeta.execution_report))
      : null
  )
  const pendingDecisionPersistRef = useRef<Promise<void> | null>(null)
  const pendingTrizPersistRef = useRef<Promise<void> | null>(null)
  const [reportVariant, setReportVariant] = useState<'classic' | 'action'>('action')
  const lastBoardChangeAt = Number(snapshot.sourceUpdatedAt || 0) || null
  const [reportUpdatedAt, setReportUpdatedAt] = useState<number | null>(
    snapshot.reportMeta?.updatedAt ?? snapshot.reportMeta?.createdAt ?? null
  )
  const lastReportUpdateAt = reportUpdatedAt
  const reportIsOutdated =
    Boolean(lastBoardChangeAt && lastReportUpdateAt && lastBoardChangeAt > lastReportUpdateAt)
  const [priceMinor, setPriceMinor] = useState<number | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  const [trizImagePrices, setTrizImagePrices] = useState<{
    generate: number | null
    regenerate: number | null
  }>({ generate: null, regenerate: null })
  const [trizImagePriceLoading, setTrizImagePriceLoading] = useState(false)
  const [trizImageLoading, setTrizImageLoading] = useState<Record<string, boolean>>({})
  const [trizImageDeleting, setTrizImageDeleting] = useState<Record<string, boolean>>({})
  const [trizImageErrors, setTrizImageErrors] = useState<Record<string, string | null>>({})
  const [trizApproachSelecting, setTrizApproachSelecting] = useState<Record<string, boolean>>({})
  const balanceCurrency: 'PLN' | 'USD' = billingCurrency
  const handleDecisionSelect = async (decisionIndex: number, selectedOption: 'a' | 'b') => {
    if (!executionReport?.decisions?.[decisionIndex]) return
    if (executionReport.decisions[decisionIndex]?.selected_option === selectedOption) return
    const invalidatesPlan = executionReport.stage === 'plan_generated'
    const nextExecutionReport: ReportExecutionReport = {
      ...executionReport,
      stage: invalidatesPlan ? 'awaiting_decisions' : executionReport.stage,
      priorities: invalidatesPlan ? [] : executionReport.priorities,
      action_plan: invalidatesPlan ? [] : executionReport.action_plan,
      validation_loop: invalidatesPlan ? [] : executionReport.validation_loop,
      next_session_focus: invalidatesPlan ? '' : executionReport.next_session_focus,
      decisions: executionReport.decisions.map((item, index) =>
        index === decisionIndex ? { ...item, selected_option: selectedOption } : item
      ),
    }
    setExecutionReport(nextExecutionReport)
    onReportMetaChange?.({
      execution_report: nextExecutionReport,
      updatedAt: Date.now(),
    })
    if (!client || !reportSessionId) return
    try {
      const base = reportMetaRef.current && typeof reportMetaRef.current === 'object' ? reportMetaRef.current : {}
      const persistPromise = updateReportBySessionId(reportSessionId, {
        summary_json: {
          ...base,
          execution_report: nextExecutionReport,
        },
      })
      pendingDecisionPersistRef.current = persistPromise.then(() => undefined).catch(() => undefined)
      await persistPromise
      reportMetaRef.current = { ...base, execution_report: nextExecutionReport }
    } catch (error) {
      console.error('[report][decision-select] persist_failed', {
        sessionId: reportSessionId,
        decisionIndex,
        selectedOption,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const formatBalanceMinor = (currency: 'PLN' | 'USD', minor: number) => {
    const locale = currency === 'PLN' ? 'pl-PL' : 'en-US'
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.max(0, minor || 0) / 100)
  }

  useEffect(() => {
    const supabaseClient = client
    if (!supabaseClient) return
    let cancelled = false
    const loadPrice = async () => {
      setPriceLoading(true)
      try {
        const { data, error } = await supabaseClient
          .from('pricing_rules_public')
          .select('price_grosze,price_cents')
          .eq('action_key', 'report_update')
          .maybeSingle()
        if (!cancelled) {
          if (error) {
            setPriceMinor(null)
          } else {
            const row = data as {
              price_grosze?: number | string | null
              price_cents?: number | string | null
            } | null
            const raw =
              billingCurrency === 'USD' ? row?.price_cents : row?.price_grosze
            const value = Number(raw)
            setPriceMinor(Number.isFinite(value) ? value : null)
          }
        }
      } catch {
        if (!cancelled) setPriceMinor(null)
      } finally {
        if (!cancelled) setPriceLoading(false)
      }
    }
    void loadPrice()
    return () => {
      cancelled = true
    }
  }, [billingCurrency])

  useEffect(() => {
    const supabaseClient = client
    if (!supabaseClient) return
    let cancelled = false
    const loadTrizImagePrices = async () => {
      setTrizImagePriceLoading(true)
      try {
        const { data, error } = await supabaseClient
          .from('pricing_rules_public')
          .select('action_key,price_grosze,price_cents')
          .in('action_key', ['image_generate', 'image_regenerate'])
        if (cancelled) return
        if (error || !Array.isArray(data)) {
          setTrizImagePrices({ generate: null, regenerate: null })
          return
        }
        const next = { generate: null as number | null, regenerate: null as number | null }
        data.forEach((row) => {
          const typedRow = row as
            | {
                action_key?: string | null
                price_grosze?: number | string | null
                price_cents?: number | string | null
              }
            | null
          const raw =
            billingCurrency === 'USD'
              ? Number(typedRow?.price_cents ?? NaN)
              : Number(typedRow?.price_grosze ?? NaN)
          const value = Number.isFinite(raw) ? raw : null
          if (typedRow?.action_key === 'image_generate') next.generate = value
          if (typedRow?.action_key === 'image_regenerate') next.regenerate = value
        })
        setTrizImagePrices(next)
      } catch {
        if (!cancelled) setTrizImagePrices({ generate: null, regenerate: null })
      } finally {
        if (!cancelled) setTrizImagePriceLoading(false)
      }
    }
    void loadTrizImagePrices()
    return () => {
      cancelled = true
    }
  }, [billingCurrency])
  const [isReportUpdating, setIsReportUpdating] = useState(false)
  const [labelUpdating, setLabelUpdating] = useState<Record<string, boolean>>({})
  const [summaryUsage] = useState<SummaryUsage | null>(null)
  const [updateNotice, setUpdateNotice] = useState<string | null>(null)
  const summaryAutoAttempted = useRef(false)
  const reportSessionId = useMemo(() => {
    if (snapshot.sessionId) return snapshot.sessionId
    if (typeof window === 'undefined') return null
    return window.sessionStorage.getItem('reportReturnSessionId') || null
  }, [snapshot.sessionId])
  const [reportMetaLoaded, setReportMetaLoaded] = useState(!client || !reportSessionId)
  const labelErrorText = t.labelSaveError

  const isEmptySummaryText = (text: string | null | undefined, lang: 'pl' | 'en') => {
    const value = String(text || '').trim()
    if (!value) return true
    const lower = value.toLowerCase()
    if (lang === 'pl') {
      const phrases = [
        'brak wystarczających danych',
        'brak bezpośrednich informacji',
        'nie generuję podsumowania',
        'brak wpisów',
        'brak informacji',
        'zbyt mało informacji',
      ]
      if (phrases.some((phrase) => lower.includes(phrase))) return true
      if (/brak.*(danych|informacji|wpis(ów|ow)).*/i.test(value)) return true
      if (/nie generuj[eę].*podsumowania/i.test(value)) return true
      if (/\([A-C][1-3]\)/.test(value) && /brak/i.test(value)) return true
      return false
    }
    const phrases = [
      'not enough data',
      'insufficient data',
      'no direct information',
      'no entries',
      'cannot generate',
    ]
    if (phrases.some((phrase) => lower.includes(phrase))) return true
    if (/not enough|insufficient|no (direct )?information|no entries|cannot generate/i.test(value)) {
      return true
    }
    return false
  }
  const productNameCandidate = useMemo(
    () =>
      extractProductNameFromSessionName(
        snapshot.sessionName || '',
        language === 'pl' ? 'pl' : 'en'
      ),
    [snapshot.sessionName, language]
  )
  const sessionGoalText = useMemo(
    () =>
      buildSessionGoalText({
        lang: language === 'pl' ? 'pl' : 'en',
        productName: productNameCandidate,
      }),
    [language, productNameCandidate]
  )

  useEffect(() => {
    return undefined
  }, [])

  useEffect(() => {
    setSummaryItems(sanitizeReportPayload(snapshot.ideas))
  }, [snapshot.ideas])

  useEffect(() => {
    setReportUpdatedAt(snapshot.reportMeta?.updatedAt ?? snapshot.reportMeta?.createdAt ?? null)
  }, [snapshot.reportMeta?.updatedAt, snapshot.reportMeta?.createdAt])

  useEffect(() => {
    if (!client || !reportSessionId) {
      setReportMetaLoaded(true)
      return
    }
    setReportMetaLoaded(false)
    let cancelled = false
    ;(async () => {
      try {
        const record = await fetchReportBySessionId(reportSessionId)
        if (cancelled || !record) return
        const mergedExecutionReport = mergeExecutionDecisionSelections(
          record.executionReport
            ? normalizeExecutionReport(sanitizeReportPayload(record.executionReport))
            : null,
          executionReport ??
            (snapshot.reportMeta?.execution_report
              ? normalizeExecutionReport(sanitizeReportPayload(snapshot.reportMeta.execution_report))
              : null)
        )
        setReportRecommendations(
          normalizeRecommendations(sanitizeReportPayload(record.recommendations))
        )
        setReportTriz(record.triz ? normalizeTriz(sanitizeReportPayload(record.triz)) : null)
        setExecutionReport(mergedExecutionReport)
        if (!aiSummary && record.summary) {
          setAiSummary(sanitizeReportPayload(record.summary))
        }
        if (!lastSummaryTextHash && record.lastSummaryTextHash) {
          setLastSummaryTextHash(record.lastSummaryTextHash)
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setReportMetaLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reportSessionId])

  useEffect(() => {
    summaryAutoAttempted.current = false
    setSummaryStatus('idle')
  }, [language])

  useEffect(() => {
    if (!updateNotice) return
    const timer = window.setTimeout(() => setUpdateNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [updateNotice])

  useEffect(() => {
    setUpdateNotice(null)
  }, [language])

  const showUpdate = (() => {
    if (typeof window === 'undefined') return true
    return !(window.history.state && window.history.state.newlyCreated === true)
  })()

    if (import.meta.env.DEV) {
      if (snapshot.reportMeta?.ideas?.length) {
        console.warn('Items section must not use summary_json as source')
      }
      console.assert(
        sanitizeReportText('Rynek ... (A1).') === 'Rynek ...',
        'sanitizeReportText should remove (A1)'
      )
    console.assert(
      sanitizeReportText('..., (B1, C1) oraz ...') === '..., oraz ...',
      'sanitizeReportText should remove (B1, C1)'
    )
    console.assert(
      sanitizeReportText('Funkcje B2.') === 'Funkcje.',
      'sanitizeReportText should remove trailing B2'
    )
    console.assert(
      sanitizeReportText('Model A1 Pro') === 'Model A1 Pro',
      'sanitizeReportText should keep A1 in names'
    )
  }

  const handleUpdateReport = async (mode?: 'plan_from_decisions' | 'plan_from_decisions_only') => {
    if (typeof window === 'undefined') return
    const sessionId =
      snapshot.sessionId || window.sessionStorage.getItem('reportReturnSessionId') || ''
    const sourceUpdatedAt = Number(snapshot.sourceUpdatedAt || 0)
    if (!sessionId) {
      setUpdateNotice(t.labelSaveError)
      return
    }
    setIsReportUpdating(true)
    try {
      if (mode === 'plan_from_decisions' || mode === 'plan_from_decisions_only') {
        await pendingDecisionPersistRef.current
      }
      const sessionRes = client ? await client.auth.getSession() : null
      const token = sessionRes?.data?.session?.access_token || ''
      const payload: any = { sessionId: reportSessionId || sessionId, lang: language }
      if (mode) payload.execution_mode = mode
      if (mode === 'plan_from_decisions' || mode === 'plan_from_decisions_only') {
        payload.execution_report = executionReport
      }
      const response = await fetch('/api/report?action=update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(diagnosticsEnabled ? { 'x-diagnostics': '1' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      const responsePayload = await response.json().catch(() => null)
      if (responsePayload?.meta) {
        const meta = responsePayload.meta as any
        const maybeEmitUsage = (value: any) => {
          if (!value || typeof value !== 'object') return
          if (value.tokens && typeof value.tokens === 'object') {
            onAiUsage?.(value)
          }
        }
        // Backend may return a meta map, e.g. { execution_plan_from_decisions: { tokens... } }.
        maybeEmitUsage(meta)
        Object.values(meta).forEach((value) => maybeEmitUsage(value))
      }
      if (!response.ok || !responsePayload?.ok) {
        if (responsePayload?.error === 'INSUFFICIENT_BALANCE') {
          onBillingInsufficient?.()
          return
        }
        setUpdateNotice(t.labelSaveError)
        return
      }
      if (
        mode === 'plan_from_decisions_only' &&
        responsePayload?.execution &&
        responsePayload.execution.planGenerated === false &&
        responsePayload.execution.planSkippedReason === 'DECISIONS_INCOMPLETE'
      ) {
        setUpdateNotice(
          language === 'pl'
            ? 'Wybierz opcje A/B we wszystkich kluczowych decyzjach, aby sfinalizować plan.'
            : 'Select A/B for all key decisions to finalize the plan.'
        )
      }
      if (
        mode === 'plan_from_decisions_only' &&
        responsePayload?.execution &&
        responsePayload.execution.planGenerated === false &&
        responsePayload.execution.planSkippedReason === 'NO_SELECTIONS'
      ) {
        setUpdateNotice(
          language === 'pl'
            ? 'Zaznacz przynajmniej jedną decyzję lub podejście TRIZ, aby sfinalizować plan.'
            : 'Select at least one decision or TRIZ approach to finalize the plan.'
        )
      }
      if (response.ok && responsePayload?.ok) {
        onBillingRefresh?.()
      }
    } catch (error) {
      setUpdateNotice(t.labelSaveError)
      return
    } finally {
      setIsReportUpdating(false)
    }
    if (reportSessionId) {
      try {
        const record = await fetchReportBySessionId(reportSessionId)
        if (record) {
          applyReportRecord(record)
          setSummaryStatus('done')
        }
      } catch {
        // ignore
      }
    }
    const storedRaw = window.sessionStorage.getItem(
      `report_source_updated_at::${sessionId}`
    )
    const stored = Number(storedRaw || 0)
    if (!sourceUpdatedAt || sourceUpdatedAt <= stored) {
      setUpdateNotice(t.reportNoChanges)
      return
    }
    window.sessionStorage.setItem(
      `report_source_updated_at::${sessionId}`,
      String(sourceUpdatedAt)
    )
    setUpdateNotice(t.reportUpdated)
  }

  const formatActionPrice = (minor: number | null) => {
    if (!Number.isFinite(minor ?? NaN)) return null
    return formatBalanceMinor(balanceCurrency, minor || 0)
  }

  const applyReportRecord = (record: Awaited<ReturnType<typeof fetchReportBySessionId>>) => {
    if (!record) return
    const normalized = validateAndNormalizeReport({
      summary: record.summary,
      ideas: record.ideas,
      recommendations: record.recommendations,
      triz: record.triz,
      execution_report: record.executionReport,
    })
    const sanitized = sanitizeReportPayload(normalized)
    reportMetaRef.current = sanitized
    const mergedExecutionReport = mergeExecutionDecisionSelections(
      record.executionReport
        ? normalizeExecutionReport(sanitizeReportPayload(record.executionReport))
        : null,
      executionReport ??
        (snapshot.reportMeta?.execution_report
          ? normalizeExecutionReport(sanitizeReportPayload(snapshot.reportMeta.execution_report))
          : null)
    )
    setReportRecommendations(sanitized.recommendations)
    setReportTriz(record.triz ? normalizeTriz(sanitizeReportPayload(record.triz)) : null)
    setExecutionReport(mergedExecutionReport)
    setAiSummary(sanitized.summary)
    setLastSummaryTextHash(record.lastSummaryTextHash ?? null)
    setReportUpdatedAt(record.updatedAt ?? record.createdAt ?? null)
    onReportMetaChange?.({
      summary: sanitized.summary,
      ideas: sanitized.ideas,
      recommendations: sanitized.recommendations,
      triz: sanitized.triz,
      execution_report: sanitized.execution_report,
      lastSummaryTextHash: record.lastSummaryTextHash ?? null,
      createdAt: record.createdAt ?? null,
      updatedAt: record.updatedAt ?? null,
    })
  }

  const handleSelectTrizApproach = async (
    contradictionIndex: number,
    solutionIndex: number,
    solutionTitle: string
  ) => {
    if (!reportSessionId || typeof window === 'undefined') return
    const requestKey = `${contradictionIndex}:${solutionIndex}`
    setTrizApproachSelecting((prev) => ({ ...prev, [requestKey]: true }))
    try {
      const base =
        reportMetaRef.current && typeof reportMetaRef.current === 'object' ? reportMetaRef.current : {}
      const currentTriz = reportTriz ? normalizeTriz(reportTriz) : normalizeTriz(base.triz ?? null)
      const contradiction = currentTriz.contradictions[contradictionIndex]
      if (!contradiction) return
      const renderedApproaches =
        Array.isArray(contradiction.approaches) && contradiction.approaches.length
          ? contradiction.approaches
          : contradiction.solutions
      if (!renderedApproaches?.[solutionIndex]) return
      const current = Array.isArray(contradiction.selected_approach_indices)
        ? contradiction.selected_approach_indices
        : []
      const has = current.includes(solutionIndex)
      const nextIndices = has
        ? current.filter((idx) => idx !== solutionIndex)
        : [...current, solutionIndex]
      const currentTitles = Array.isArray(contradiction.selected_approach_titles)
        ? contradiction.selected_approach_titles
        : []
      const nextTitles = has
        ? currentTitles.filter((title) => title !== solutionTitle)
        : Array.from(new Set([...currentTitles, solutionTitle]))
      const nextTriz: ReportTrizSection = {
        ...currentTriz,
        contradictions: currentTriz.contradictions.map((item, idx) =>
          idx === contradictionIndex
            ? {
                ...item,
                selected_approach_indices: nextIndices,
                selected_approach_titles: nextTitles,
              }
            : item
        ),
      }

      const invalidatesPlan = executionReport?.stage === 'plan_generated'
      const nextExecutionReport: ReportExecutionReport | null = invalidatesPlan && executionReport
        ? {
            ...executionReport,
            stage: 'awaiting_decisions',
            priorities: [],
            action_plan: [],
            validation_loop: [],
            next_session_focus: '',
          }
        : executionReport

      setReportTriz(nextTriz)
      if (invalidatesPlan && nextExecutionReport) {
        setExecutionReport(nextExecutionReport)
      }
      onReportMetaChange?.({
        triz: nextTriz,
        ...(invalidatesPlan && nextExecutionReport ? { execution_report: nextExecutionReport } : {}),
        updatedAt: Date.now(),
      })
      if (!client || !reportSessionId) return
      const persistPromise = (async () => {
        const sessionRes = client ? await client.auth.getSession() : null
        const token = sessionRes?.data?.session?.access_token || ''
        const response = await fetch('/api/report?action=update', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(diagnosticsEnabled ? { 'x-diagnostics': '1' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            sessionId: reportSessionId,
            lang: language,
            execution_mode: 'triz_select_approach',
            triz_selection: {
              contradiction_index: contradictionIndex,
              approach_index: solutionIndex,
              approach_title: solutionTitle,
              mode: 'toggle',
            },
          }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) {
          if (payload?.error === 'INSUFFICIENT_BALANCE') {
            onBillingInsufficient?.()
          }
          throw new Error(
            typeof payload?.error === 'string' && payload.error
              ? payload.error
              : 'TRIZ_SELECT_FAILED'
          )
        }
        reportMetaRef.current = { ...base, triz: nextTriz }
        const refreshed = await fetchReportBySessionId(reportSessionId)
        if (refreshed) applyReportRecord(refreshed)
      })()
      pendingTrizPersistRef.current = persistPromise.then(() => undefined).catch(() => undefined)
      await persistPromise
    } catch (error) {
      console.error('[report][triz-select] persist_failed', {
        sessionId: reportSessionId,
        contradictionIndex,
        solutionIndex,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setTrizApproachSelecting((prev) => ({ ...prev, [requestKey]: false }))
    }
  }

  const handleBack = async () => {
    try {
      if (pendingDecisionPersistRef.current) await pendingDecisionPersistRef.current
      if (pendingTrizPersistRef.current) await pendingTrizPersistRef.current
    } catch {
      // ignore
    }
    onBack()
  }

  const handleGenerateTrizImage = async (contradictionIndex: number, solutionIndex: number) => {
    if (!reportSessionId || typeof window === 'undefined') return
    const requestKey = `${contradictionIndex}:${solutionIndex}`
    setTrizImageLoading((prev) => ({ ...prev, [requestKey]: true }))
    setTrizImageErrors((prev) => ({ ...prev, [requestKey]: null }))
    try {
      const sessionRes = client ? await client.auth.getSession() : null
      const token = sessionRes?.data?.session?.access_token || ''
      const response = await fetch('/api/report?action=generate-triz-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId: reportSessionId,
          contradictionIndex,
          solutionIndex,
          lang: language,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (payload?.meta) {
        onAiUsage?.(payload.meta)
      }
      if (!response.ok || !payload?.ok) {
        const errorCode =
          typeof payload?.code === 'string'
            ? payload.code
            : typeof payload?.error === 'string'
              ? payload.error
              : ''
        const errorMessage =
          typeof payload?.message === 'string' && payload.message
            ? payload.message
            : errorCode || t.trizImageFailed
        if (errorCode === 'INSUFFICIENT_BALANCE') {
          onBillingInsufficient?.()
          return
        }
        setTrizImageErrors((prev) => ({
          ...prev,
          [requestKey]: errorMessage,
        }))
        return
      }
      onBillingRefresh?.()
      if (payload?.report) {
        const refreshed = await fetchReportBySessionId(reportSessionId)
        if (refreshed) {
          applyReportRecord(refreshed)
        }
      } else {
        const refreshed = await fetchReportBySessionId(reportSessionId)
        if (refreshed) {
          applyReportRecord(refreshed)
        }
      }
    } catch (error) {
      console.error('[triz-image][ui] request_failed', {
        requestKey,
        message: error instanceof Error ? error.message : String(error),
        error,
      })
      setTrizImageErrors((prev) => ({ ...prev, [requestKey]: t.trizImageFailed }))
    } finally {
      setTrizImageLoading((prev) => ({ ...prev, [requestKey]: false }))
    }
  }

  const handleDeleteTrizImage = async (
    contradictionIndex: number,
    solutionIndex: number,
    image: ReportTrizSolutionImage,
    galleryIndex: number
  ) => {
    if (!reportSessionId || typeof window === 'undefined') return
    const deleteKey = `${contradictionIndex}:${solutionIndex}:${
      image.storage_path || image.public_url || galleryIndex
    }`
    const requestKey = `${contradictionIndex}:${solutionIndex}`
    setTrizImageDeleting((prev) => ({ ...prev, [deleteKey]: true }))
    setTrizImageErrors((prev) => ({ ...prev, [requestKey]: null }))
    try {
      const sessionRes = client ? await client.auth.getSession() : null
      const token = sessionRes?.data?.session?.access_token || ''
      const response = await fetch('/api/report?action=delete-triz-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId: reportSessionId,
          contradictionIndex,
          solutionIndex,
          storagePath: image.storage_path || null,
          publicUrl: image.public_url || null,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) {
        const errorMessage =
          typeof payload?.message === 'string' && payload.message
            ? payload.message
            : typeof payload?.code === 'string' && payload.code
              ? payload.code
              : t.trizImageDeleteFailed
        setTrizImageErrors((prev) => ({
          ...prev,
          [requestKey]: errorMessage,
        }))
        return
      }
      const refreshed = await fetchReportBySessionId(reportSessionId)
      if (refreshed) {
        applyReportRecord(refreshed)
      }
    } catch {
      setTrizImageErrors((prev) => ({ ...prev, [requestKey]: t.trizImageDeleteFailed }))
    } finally {
      setTrizImageDeleting((prev) => ({ ...prev, [deleteKey]: false }))
    }
  }

  const handleDownloadTrizImage = async (
    image: ReportTrizSolutionImage,
    solution: ReportTrizSolution,
    galleryIndex: number
  ) => {
    if (typeof window === 'undefined' || !image.public_url) return
    const resolveImageExt = (value: string) => {
      const raw = String(value || '').trim()
      const match = raw.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i)
      const ext = match?.[1]?.toLowerCase() || ''
      if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') return ext
      return 'png'
    }
    const downloadedAt = new Date()
    const downloadedDate = downloadedAt.toISOString().slice(0, 10) // YYYY-MM-DD
    const sessionNamePart = sanitizeFilenamePart(snapshot.sessionName || 'session')
    const approachName = sanitizeFilenamePart(solution.title || 'triz-approach')
    const imageNumber = galleryIndex + 1
    const ext = resolveImageExt(image.file_name || image.public_url)
    const fileName = `${sessionNamePart}-${downloadedDate}-${approachName}-${imageNumber}.${ext}`
    try {
      const response = await fetch(image.public_url)
      if (!response.ok) throw new Error('DOWNLOAD_FAILED')
      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(image.public_url, '_blank', 'noopener,noreferrer')
    }
  }

  const handlePrintReport = () => {
    if (typeof document === 'undefined') return
    const originalTitle = document.title
    const downloadedDate = new Date().toISOString().slice(0, 10)
    const kindLabel = language === 'pl' ? 'plan-dzialania' : 'action-plan'
    const fileName = `${sanitizeFilenamePart(snapshot.sessionName)}-${downloadedDate}-${kindLabel}.pdf`
    document.title = fileName
    window.print()
    window.setTimeout(() => {
      document.title = originalTitle
    }, 0)
  }

  const handleLabelChange = async (idea: ReportSnapshot['ideas'][number], nextValue: string) => {
    if (!idea?.id) return
    const nextLabel = nextValue || null
    const previousLabel = idea.label ?? null
    setSummaryItems((prev) =>
      prev.map((item) => (item.id === idea.id ? { ...item, label: nextLabel } : item))
    )
    setLabelUpdating((prev) => ({ ...prev, [idea.id]: true }))
    let ok = false
    try {
      if (onUpdateLabel) {
        ok = await onUpdateLabel(idea.id, nextLabel)
      }
    } catch {
      ok = false
    }
    if (!ok) {
      setSummaryItems((prev) =>
        prev.map((item) => (item.id === idea.id ? { ...item, label: previousLabel } : item))
      )
      setUpdateNotice(labelErrorText)
    }
    setLabelUpdating((prev) => {
      const next = { ...prev }
      delete next[idea.id]
      return next
    })
  }

  const generateSummaryIfNeeded = async () => {
    if (summaryStatus === 'running') return
    if (summaryAutoAttempted.current) return
    summaryAutoAttempted.current = true
    setSummaryStatus('done')
  }

  useEffect(() => {
    if (!reportMetaLoaded) return
    void generateSummaryIfNeeded()
  }, [reportMetaLoaded, aiSummary, lastSummaryTextHash])

  const cleanedSummary = useMemo(() => {
    const lang = language === 'pl' ? 'pl' : 'en'
    return {
      headline: isEmptySummaryText(aiSummary?.headline, lang)
        ? null
        : sanitizeReportText(aiSummary?.headline || ''),
      narrative: isEmptySummaryText(aiSummary?.narrative, lang)
        ? null
        : sanitizeReportText(aiSummary?.narrative || ''),
      today: isEmptySummaryText(aiSummary?.today, lang)
        ? null
        : sanitizeReportText(aiSummary?.today || ''),
      change: isEmptySummaryText(aiSummary?.change, lang)
        ? null
        : sanitizeReportText(aiSummary?.change || ''),
      product: isEmptySummaryText(aiSummary?.product, lang)
        ? null
        : sanitizeReportText(aiSummary?.product || ''),
    }
  }, [aiSummary, language])
  const hasNarrativeSummary = Boolean(cleanedSummary.headline || cleanedSummary.narrative)
  const normalizedTriz = useMemo(
    () => (reportTriz ? normalizeTriz(sanitizeReportPayload(reportTriz)) : null),
    [reportTriz]
  )
  const hasTrizSection = Boolean(normalizedTriz)
  const hasTriz = Boolean(normalizedTriz?.contradictions.length)
  const normalizedExecutionReport = useMemo(
    () => (executionReport ? normalizeExecutionReport(sanitizeReportPayload(executionReport)) : null),
    [executionReport]
  )
  const hasLeanExecutionReport = hasLeanExecutionReportContent(normalizedExecutionReport)
  const decisionsAllSelected = Boolean(
    normalizedExecutionReport?.decisions?.length &&
      normalizedExecutionReport.decisions.every(
        (d) => d.selected_option === 'a' || d.selected_option === 'b'
      )
  )
  const canBuildPlanFromDecisions =
    reportVariant === 'action' &&
    normalizedExecutionReport?.stage !== 'plan_generated' &&
    decisionsAllSelected
  const updateCtaLabel =
    canBuildPlanFromDecisions
      ? language === 'pl'
        ? 'Sfinalizuj plan działania'
        : 'Finalize action plan'
      : t.reportUpdate
  const updateCtaMode = canBuildPlanFromDecisions ? 'plan_from_decisions_only' : undefined

  useEffect(() => {
    if (reportVariant !== 'action') return
    if (hasLeanExecutionReport) return
    console.log('[report][action-plan] execution_report_lean_render_fallback', {
      sessionId: reportSessionId,
    })
  }, [reportVariant, hasLeanExecutionReport, reportSessionId])
  const resolveQuestionText = (idea: (typeof summaryItems)[number] | null | undefined) => {
    if (!idea) return ''
    const primary =
      language === 'pl'
        ? (idea as { questionTextPl?: string | null }).questionTextPl ??
          (idea as { question_text_pl?: string | null }).question_text_pl ??
          null
        : (idea as { questionTextEn?: string | null }).questionTextEn ??
          (idea as { question_text_en?: string | null }).question_text_en ??
          null
    const secondary =
      language === 'pl'
        ? (idea as { questionTextEn?: string | null }).questionTextEn ??
          (idea as { question_text_en?: string | null }).question_text_en ??
          null
        : (idea as { questionTextPl?: string | null }).questionTextPl ??
          (idea as { question_text_pl?: string | null }).question_text_pl ??
          null
    return sanitizeReportText(primary || secondary || '')
  }
  const recommendations = reportRecommendations as
    | {
        based_on_user_ideas: Array<{
          title: string
          rationale: string
          how_to_test: string
          methods?: string[]
          confidence?: 'low' | 'med' | 'high'
        }>
        morphological: Array<{
          title: string
          rationale: string
          how_to_test: string
          methods?: string[]
          confidence?: 'low' | 'med' | 'high'
        }>
        market_trends: Array<{
          title: string
          rationale: string
          how_to_test: string
          methods?: string[]
          confidence?: 'low' | 'med' | 'high'
        }>
      }
  const hasRecommendations =
    recommendations.based_on_user_ideas.length ||
    recommendations.morphological.length ||
    recommendations.market_trends.length
  const renderTrizSection = (sectionId: string, keyPrefix = 'triz') => (
    <section id={sectionId} className="report-section">
      <h2>{normalizedTriz?.section_title || t.trizTitle}</h2>
      <p>{normalizedTriz?.section_intro || t.trizIntro}</p>
      <p className="muted report-triz-selection-hint">{t.trizSelectionHint}</p>
      {!hasTriz ? (
        <p className="muted report-triz-empty">{t.trizEmpty}</p>
      ) : (
        normalizedTriz!.contradictions.map((item, index) => {
          const renderedApproaches = item.approaches?.length ? item.approaches : item.solutions
          return (
            <div
              key={`${keyPrefix}-${index}`}
              className="report-summary-block report-triz-contradiction"
            >
              <h3>{sanitizeReportText(item.title)}</h3>
              {item.explanation ? (
                <>
                  <h3>{t.trizExplanation}</h3>
                  <p>{sanitizeReportText(item.explanation)}</p>
                </>
              ) : (
                <>
                  <p>{sanitizeReportText(item.description || '')}</p>
                  {item.improving ? (
                    <p>
                      <strong>{t.trizImproving}:</strong> {sanitizeReportText(item.improving)}
                    </p>
                  ) : null}
                  {item.worsening ? (
                    <p>
                      <strong>{t.trizWorsening}:</strong> {sanitizeReportText(item.worsening)}
                    </p>
                  ) : null}
                </>
              )}
              {item.solution_directions?.length ? (
                <>
                  <h3>{t.trizDirections}</h3>
                  <ul>
                    {item.solution_directions.map((direction, directionIndex) => (
                      <li key={`${keyPrefix}-direction-${index}-${directionIndex}`}>
                        {sanitizeReportText(direction)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : item.principles?.length ? (
                <>
                  <h3>{t.trizPrinciples}</h3>
                  <ul>
                    {item.principles.map((principle, principleIndex) => (
                      <li key={`${keyPrefix}-principle-${index}-${principleIndex}`}>
                        <strong>{sanitizeReportText(principle.name)}</strong>
                        {principle.rationale ? (
                          <div>{sanitizeReportText(principle.rationale)}</div>
                        ) : null}
                        {principle.how_to_apply ? (
                          <div>{sanitizeReportText(principle.how_to_apply)}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {renderedApproaches.length ? (
                <>
                  <h3>{item.approaches?.length ? t.trizApproaches : t.trizSolutions}</h3>
                  <ul className="triz-solutions-list">
                    {renderedApproaches.map((solution, solutionIndex) => {
                      const requestKey = `${index}:${solutionIndex}`
                      const selectedIndices = Array.isArray(item.selected_approach_indices)
                        ? item.selected_approach_indices
                        : []
                      const isSelected = selectedIndices.includes(solutionIndex)
                      const isSelecting = Boolean(trizApproachSelecting[requestKey])
                      const image = solution.image || null
                      const readyImages = Array.isArray(solution.images)
                        ? solution.images.filter(
                            (entry) => entry?.status === 'ready' && Boolean(entry.public_url)
                          )
                        : image?.status === 'ready' && image.public_url
                          ? [image]
                          : []
                      const imageReady = readyImages.length > 0
                      const isGenerating = Boolean(trizImageLoading[requestKey])
                      const errorText = trizImageErrors[requestKey] || image?.error_message || null
                      const hasRichDescription = Boolean(solution.description.trim())
                      const priceLabel = formatActionPrice(
                        imageReady ? trizImagePrices.regenerate : trizImagePrices.generate
                      )
                      const actionLabel = imageReady
                        ? t.trizRegenerateSketch
                        : t.trizGenerateSketch
                      return (
                        <li
                          key={`${keyPrefix}-solution-${index}-${solutionIndex}`}
                          className={`triz-solution-item${isSelected ? ' is-selected' : ''}${
                            isSelecting ? ' is-selecting' : ''
                          }`}
                          onClick={() =>
                            void handleSelectTrizApproach(index, solutionIndex, solution.title)
                          }
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              void handleSelectTrizApproach(index, solutionIndex, solution.title)
                            }
                          }}
                        >
                          {isSelected && (
                            <span className="triz-solution-item__ok" aria-hidden="true">
                              {language === 'pl' ? 'Wybrano' : 'Selected'}
                            </span>
                          )}
                          <div className="triz-solution-copy">
                            <div className="triz-solution-title">
                              {sanitizeReportText(solution.title)}
                            </div>
                            {hasRichDescription && (
                              <p className="triz-solution-description">
                                {sanitizeReportText(solution.description)}
                              </p>
                            )}
                            <div className="triz-solution-actions">
                              <button
                                type="button"
                                className="secondary triz-image-button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleGenerateTrizImage(index, solutionIndex)
                                }}
                                disabled={isGenerating || trizImagePriceLoading}
                              >
                                {isGenerating && (
                                  <span className="button-spinner button-spinner--dark" aria-hidden="true" />
                                )}
                                {isGenerating
                                  ? t.trizGeneratingImage
                                  : `${actionLabel}${priceLabel ? ` — ${priceLabel}` : ''}`}
                              </button>
                            </div>
                            {errorText ? (
                              <p className="report-error">{sanitizeReportText(errorText)}</p>
                            ) : !imageReady ? (
                              <p className="muted">{t.trizNoImageYet}</p>
                            ) : null}
                          </div>
                          {imageReady && (
                            <div className="triz-solution-gallery">
                              {readyImages.map((galleryImage, galleryIndex) => {
                                const deleteKey = `${index}:${solutionIndex}:${
                                  galleryImage.storage_path || galleryImage.public_url || galleryIndex
                                }`
                                const isDeleting = Boolean(trizImageDeleting[deleteKey])
                                return (
                                  <div
                                    key={`${keyPrefix}-image-${index}-${solutionIndex}-${galleryIndex}`}
                                    className="triz-solution-image-card"
                                  >
                                    <div className="triz-solution-image-wrap">
                                      <img
                                        className="triz-solution-image"
                                        src={galleryImage.public_url}
                                        alt={sanitizeReportText(solution.title)}
                                        loading="lazy"
                                      />
                                      <div className="triz-solution-image-overlay">
                                        <button
                                          type="button"
                                          className="icon-button triz-image-overlay-action triz-image-overlay-action--danger"
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            void handleDeleteTrizImage(
                                              index,
                                              solutionIndex,
                                              galleryImage,
                                              galleryIndex
                                            )
                                          }}
                                          disabled={isDeleting}
                                          aria-label={t.trizDeleteImage}
                                          title={t.trizDeleteImage}
                                        >
                                          {isDeleting ? (
                                            <span className="button-spinner" aria-hidden="true" />
                                          ) : (
                                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                              <path
                                                fill="currentColor"
                                                d="M9 3a1 1 0 0 0-1 1v1H5.5a1 1 0 1 0 0 2H6v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7h.5a1 1 0 1 0 0-2H16V4a1 1 0 0 0-1-1H9zm1 2h4v1h-4V5zm-1 4a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1zm6 1a1 1 0 1 0-2 0v7a1 1 0 1 0 2 0v-7z"
                                              />
                                            </svg>
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          className="icon-button triz-image-overlay-action"
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            void handleDownloadTrizImage(
                                              galleryImage,
                                              solution,
                                              galleryIndex
                                            )
                                          }}
                                          disabled={isDeleting}
                                          aria-label={t.trizSaveImage}
                                          title={t.trizSaveImage}
                                        >
                                          <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path
                                              fill="currentColor"
                                              d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.29a1 1 0 1 1 1.4 1.41l-4 3.99a1 1 0 0 1-1.4 0l-4-3.99a1 1 0 1 1 1.4-1.41L11 12.59V4a1 1 0 0 1 1-1zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z"
                                            />
                                          </svg>
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : null}
              {item.reflections?.length ? (
                <>
                  <h3>{t.trizReflections}</h3>
                  <ul>
                    {item.reflections.map((reflection, reflectionIndex) => (
                      <li key={`${keyPrefix}-reflection-${index}-${reflectionIndex}`}>
                        {sanitizeReportText(reflection)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          )
        })
      )}
    </section>
  )
  const perspectiveLabels =
    language === 'pl'
      ? {
          asIs: 'Jak jest?',
          notWorking: 'Co nie działa?',
          toBe: 'Jak powinno być?',
          empty: 'Brak danych do analizy perspektyw',
          description:
            'Mapa perspektyw pokazuje, na czym skupiłeś się podczas pracy nad pomysłem. Każdy kolor to inna perspektywa – stan obecny, to co nie działa oraz to, jak powinno być. Dzięki temu szybko zobaczysz, które obszary są już dobrze opisane, a które warto jeszcze uzupełnić, żeby obraz pomysłu był pełniejszy. Jeśli któraś perspektywa ma mniej wpisów, możesz do niej wrócić i dopisać kilka myśli, żeby lepiej zbalansować całość.',
        }
      : {
          asIs: 'As is',
          notWorking: 'What doesn’t work',
          toBe: 'How it should be',
          empty: 'No data to analyze perspectives',
          description:
            'The perspective map shows where your attention went while working on the idea. Each color represents a different viewpoint — the current state, what isn’t working, and how it should be. This helps you quickly spot which areas are well covered and which ones may need more input to get a more complete picture. If one perspective has fewer entries, you can return to it and add a few thoughts to balance things out.',
        }
  const perspectiveData = useMemo(() => {
    const rows = ['world', 'product', 'elements']
    const counts = { asIs: 0, notWorking: 0, toBe: 0 }
    summaryItems.forEach((item) => {
      if (!rows.includes(String(item.matrixRow || '').toLowerCase())) return
      const col = String(item.matrixCol || '').toLowerCase()
      if (col === 'as_is') counts.asIs += 1
      else if (col === 'not_working') counts.notWorking += 1
      else if (col === 'should_be') counts.toBe += 1
    })
    const total = counts.asIs + counts.notWorking + counts.toBe
    const pct = (value: number) =>
      total ? Math.round((value / total) * 100) : 0
    return {
      total,
      counts,
      percents: {
        asIs: pct(counts.asIs),
        notWorking: pct(counts.notWorking),
        toBe: pct(counts.toBe),
      },
    }
  }, [summaryItems])
  return (
    <div className="report-page">
      <header className="engine-header report-engine-header">
        <div>
          <div className="engine-header-logo">
            <img src={reportLogoUrl} alt="MakeMyIdea.work" />
          </div>
        </div>
        <div className="engine-header-balance" aria-live="polite">
          <div className="engine-balance-row">
            <div
              className={`engine-balance${
                billingLoading || billingError ? ' engine-balance--loading' : ''
              }`}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  const returnTo =
                    window.location.hash?.startsWith('#/')
                      ? window.location.hash.slice(1)
                      : window.location.pathname || '/'
                  window.sessionStorage.setItem(TOPUP_RETURN_TO_KEY, returnTo)
                  window.location.hash = '#/topup'
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  if (typeof window !== 'undefined') {
                    const returnTo =
                      window.location.hash?.startsWith('#/')
                        ? window.location.hash.slice(1)
                        : window.location.pathname || '/'
                    window.sessionStorage.setItem(TOPUP_RETURN_TO_KEY, returnTo)
                    window.location.hash = '#/topup'
                  }
                }
              }}
            >
              <button
                type="button"
                className="engine-balance-icon"
                aria-label="Top up"
              >
                💰
              </button>
              <span className="engine-balance-value">
                {billingLoading || billingError
                  ? '—'
                  : formatBalanceMinor(balanceCurrency, balanceMinor)}
              </span>
            </div>
            {showInsufficientBalance && (
              <span className="engine-balance-warning">
                {insufficientBalanceNotice}
              </span>
            )}
          </div>
        </div>
        <div className="engine-header-actions">
          <button type="button" className="primary" onClick={() => void handleBack()}>
            {t.back}
          </button>
          {diagnosticsEnabled && (
            <div className="report-variant-switch" role="tablist" aria-label="Report variant">
              <button
                type="button"
                className={reportVariant === 'classic' ? 'secondary' : 'ghost'}
                onClick={() => setReportVariant('classic')}
              >
                {t.classicReportView}
              </button>
              <button
                type="button"
                className={reportVariant === 'action' ? 'secondary' : 'ghost'}
                onClick={() => setReportVariant('action')}
              >
                {t.actionPlanView}
              </button>
            </div>
          )}
          {diagnosticsEnabled && diagnosticsAuthLabel && (
            <span className="muted">{diagnosticsAuthLabel}</span>
          )}
          {canToggleDiagnostics && onToggleDiagnostics && diagnosticsToggleLabel && (
            <button
              className={`ai-support-toggle diagnostics-toggle ${diagnosticsEnabled ? 'on' : 'off'}`}
              type="button"
              onClick={onToggleDiagnostics}
            >
              {diagnosticsToggleLabel}
            </button>
          )}
          {diagnosticsEnabled && canToggleAiSupport && onToggleAiSupport && aiSupportToggleLabel && (
            <button
              className={`ai-support-toggle ${aiSupportEnabled ? 'on' : 'off'}`}
              type="button"
              onClick={onToggleAiSupport}
            >
              {aiSupportToggleLabel}
            </button>
          )}
          {diagnosticsEnabled && llmUsageValue && llmUsageIndicatorLabel && (
            <button
              className={`ai-support-toggle llm-usage-indicator ${llmUsageClassName}`}
              type="button"
              aria-label={llmUsageIndicatorLabel}
              title={llmUsageIndicatorLabel}
              disabled
            >
              {llmUsageValue}
            </button>
          )}
          {diagnosticsEnabled && sessionUsageDiagnostics && (
            <details className="llm-cost-details">
              <summary>Session usage diagnostics</summary>
              <div className="llm-cost-breakdown">
                <div className="llm-cost-row">sessionId: {sessionUsageDiagnostics.sessionId || '—'}</div>
                <div className="llm-cost-row">
                  summary query: {sessionUsageDiagnostics.summaryQueryStatus}
                </div>
                <div className="llm-cost-row">
                  events query: {sessionUsageDiagnostics.eventsQueryStatus}
                </div>
                <div className="llm-cost-row">
                  realtime: {sessionUsageDiagnostics.realtimeStatus || '—'}
                </div>
                <div className="llm-cost-row">
                  last checked:{' '}
                  {sessionUsageDiagnostics.lastCheckedAt
                    ? new Date(sessionUsageDiagnostics.lastCheckedAt).toLocaleString()
                    : '—'}
                </div>
                {sessionUsageDiagnostics.summaryError && (
                  <div className="llm-cost-row">
                    summary error: {sessionUsageDiagnostics.summaryError.code || '—'}:{' '}
                    {sessionUsageDiagnostics.summaryError.message}
                  </div>
                )}
                {sessionUsageDiagnostics.eventsError && (
                  <div className="llm-cost-row">
                    events error: {sessionUsageDiagnostics.eventsError.code || '—'}:{' '}
                    {sessionUsageDiagnostics.eventsError.message}
                  </div>
                )}
              </div>
            </details>
          )}
          {diagnosticsEnabled && (llmCostLines.length > 0 || llmCostBreakdownRows.length > 0) && (
            <div className="llm-cost-panel" aria-live="polite">
              {llmCostLines.map((line, index) => (
                <div key={`report-llm-cost-line-${index}`} className="llm-cost-line">
                  {line}
                </div>
              ))}
              {llmCostBreakdownLabel && llmCostBreakdownRows.length > 0 && (
                <details className="llm-cost-details">
                  <summary>{llmCostBreakdownLabel}</summary>
                  <div className="llm-cost-breakdown">
                    {llmCostBreakdownRows.map((row, index) => (
                      <div key={`report-llm-cost-row-${index}`} className="llm-cost-row">
                        {row}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          {onSaveSession && (
            <button
              className="secondary"
              type="button"
              onClick={onSaveSession}
            >
              {saveSessionLabel || 'Save session'}
            </button>
          )}
        </div>
      </header>
      <header className="report-header">
        <div>
          <div className="report-title-row">
            <h1>{t.title}</h1>
          </div>
        </div>
        <div className="report-actions">
          {showUpdate && (
            <span
              className={`report-update-cta-wrap update-action-plan-button ${
                isReportUpdating || !reportIsOutdated
                  ? reportIsOutdated
                    ? 'update-action-plan-button--disabled'
                    : 'update-action-plan-button--up-to-date'
                  : 'update-action-plan-button--needs-update'
              }`}
            >
              <AiCostButton
                label={updateCtaLabel}
                lang={language}
                priceMinor={priceMinor}
                currency={billingCurrency}
                priceLoading={priceLoading}
                loading={isReportUpdating}
                disabled={canBuildPlanFromDecisions ? isReportUpdating : !reportIsOutdated || isReportUpdating}
                disabledTooltip={
                  !canBuildPlanFromDecisions && !reportIsOutdated && !isReportUpdating
                    ? t.reportUpdateDisabledTooltip
                    : undefined
                }
                className="report-update-btn--wide-left"
                metaLayout="below"
                onClick={() => void handleUpdateReport(updateCtaMode)}
              />
              {reportIsOutdated && !isReportUpdating && (
                <span className="report-update-cta-tooltip" role="tooltip">
                  {t.reportOutdatedTooltip}
                </span>
              )}
            </span>
          )}
          {naFillStatus === 'error' && <span className="muted">{t.naAssigningError}</span>}
        </div>
      </header>
      {reportIsOutdated && (
        <div className="report-outdated report-outdated--print" role="note">
          {t.reportOutdatedPrint}
        </div>
      )}

      <main className="report-body">
        {reportVariant === 'action' ? (
          <>
            <section id="action-plan-toc" className="report-section">
              <h2>{t.toc}</h2>
              <ol className="report-toc">
                <li><a href="#your-data">{t.yourDataTitle}</a></li>
                <li><a href="#where-you-are">{t.whereYouAreTitle}</a></li>
                <li><a href="#tradeoffs">{t.trizTitle}</a></li>
                <li><a href="#decisions">{t.decisionsTitle}</a></li>
                <li><a href="#action-plan">{t.actionPlanSectionTitle}</a></li>
                <li><a href="#priorities">{t.prioritiesTitle}</a></li>
                <li><a href="#validation">{t.validationTitle}</a></li>
                <li><a href="#appendix">{t.appendices}</a></li>
              </ol>
            </section>

            <section id="your-data" className="report-section">
              <h2>{t.yourDataTitle}</h2>
              <div className="report-table-wrapper report-table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>{t.tableQuestion}</th>
                      <th>{t.tableEntry}</th>
                      <th>{t.tableLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryItems.length === 0 ? (
                      <tr><td colSpan={3}>{t.noEntries}</td></tr>
                    ) : (
                      summaryItems.filter(Boolean).map((idea) => (
                        <tr key={`action-idea-${idea.id}`}>
                          <td>{resolveQuestionText(idea)}</td>
                          <td>{idea.text || '—'}</td>
                          <td>{idea.label || '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section id="where-you-are" className="report-section">
              <h2>{t.whereYouAreTitle}</h2>
              {normalizedExecutionReport?.headline ? <p><strong>{sanitizeReportText(normalizedExecutionReport.headline)}</strong></p> : null}
              <p>{sanitizeReportText(normalizedExecutionReport?.map_context?.coverage_summary || perspectiveLabels.description)}</p>
              {normalizedExecutionReport?.map_context?.strongest_area ? (
                <p><strong>{t.strongestArea}:</strong> {sanitizeReportText(normalizedExecutionReport.map_context.strongest_area)}</p>
              ) : null}
              {normalizedExecutionReport?.map_context?.weakest_area ? (
                <p><strong>{t.weakestArea}:</strong> {sanitizeReportText(normalizedExecutionReport.map_context.weakest_area)}</p>
              ) : null}
              {normalizedExecutionReport?.map_context?.decision_risk_note ? (
                <p><strong>{t.decisionRiskNote}:</strong> {sanitizeReportText(normalizedExecutionReport.map_context.decision_risk_note)}</p>
              ) : null}
              {perspectiveData.total === 0 ? (
                <p className="muted">{perspectiveLabels.empty}</p>
              ) : (
                <>
                  <div
                    className="perspective-bar"
                    aria-label={`Mapa perspektyw: ${perspectiveLabels.asIs} ${perspectiveData.percents.asIs}%, ${perspectiveLabels.notWorking} ${perspectiveData.percents.notWorking}%, ${perspectiveLabels.toBe} ${perspectiveData.percents.toBe}%`}
                  >
                    <div className="perspective-segment as-is" style={{ width: `${perspectiveData.percents.asIs}%` }} />
                    <div className="perspective-segment not-working" style={{ width: `${perspectiveData.percents.notWorking}%` }} />
                    <div className="perspective-segment to-be" style={{ width: `${perspectiveData.percents.toBe}%` }} />
                  </div>
                  <div className="perspective-legend">
                    <span className="legend-item as-is">{perspectiveLabels.asIs}</span>
                    <span className="legend-item not-working">{perspectiveLabels.notWorking}</span>
                    <span className="legend-item to-be">{perspectiveLabels.toBe}</span>
                  </div>
                </>
              )}
            </section>

            {renderTrizSection('tradeoffs', 'action-triz')}

            <section id="decisions" className="report-section">
              <h2>{t.decisionsTitle}</h2>
              <p className="report-section-instruction">
                {language === 'pl'
                  ? 'Wybierz jedną opcję dla każdej decyzji, aby wygenerować spójny plan działania.'
                  : 'Choose one option for each decision to generate a focused action plan.'}
              </p>
              {normalizedExecutionReport?.decisions?.length ? (
                <>
                  <ul className="report-decision-list">
                    {normalizedExecutionReport.decisions.map((item, index) => (
                      <li key={`decision-${index}`} className="report-decision-item">
                        <strong className="report-decision-tradeoff">
                          {sanitizeReportText(item.tradeoff)}
                        </strong>
                        <div className="report-decision-options" role="group" aria-label={sanitizeReportText(item.tradeoff)}>
                          {(['a', 'b'] as const).map((optionKey) => {
                            const isSelected = item.selected_option === optionKey
                            const isDimmed = item.selected_option && item.selected_option !== optionKey
                            const optionTitle =
                              optionKey === 'a'
                                ? sanitizeActionPlanDetail(item.option_a)
                                : sanitizeActionPlanDetail(item.option_b)
                            const consequence =
                              optionKey === 'a'
                                ? sanitizeActionPlanDetail(item.consequence_a)
                                : sanitizeActionPlanDetail(item.consequence_b)
                            const consequenceLabel = language === 'pl' ? 'Konsekwencja' : 'Consequence'
                            const optionLabel = language === 'pl' ? 'Opcja' : 'Option'
                            const selectedLabel = language === 'pl' ? 'Wybrano' : 'Selected'
                            return (
                              <button
                                key={`decision-option-${index}-${optionKey}`}
                                type="button"
                                className={`report-decision-card${isSelected ? ' is-selected' : ''}${isDimmed ? ' is-dimmed' : ''}`}
                                onClick={() => handleDecisionSelect(index, optionKey)}
                                aria-pressed={isSelected}
                              >
                                <span className="report-decision-card__label-row">
                                  <span className="report-decision-card__label-text">
                                    {optionLabel}
                                  </span>
                                  <span className="report-decision-card__label" aria-hidden="true">
                                    {optionKey.toUpperCase()}
                                  </span>
                                </span>
                                {isSelected && (
                                  <span className="report-decision-card__ok" aria-hidden="true">
                                    {selectedLabel}
                                  </span>
                                )}
                                <span className="report-decision-card__title">
                                  {optionTitle || '—'}
                                </span>
                                <span className="report-decision-card__consequence-label">
                                  {consequenceLabel}
                                </span>
                                <span className="report-decision-card__consequence">
                                  {consequence || '—'}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {(() => {
                    return (
                      normalizedExecutionReport.stage !== 'plan_generated' &&
                      decisionsAllSelected
                    )
                  })() && (
                      <div className="report-decision-cta">
                        <span className="update-action-plan-button update-action-plan-button--needs-update">
                        <button
                          type="button"
                          className="primary"
                          onClick={() => void handleUpdateReport('plan_from_decisions_only')}
                          disabled={isReportUpdating}
                        >
                          {isReportUpdating && <span className="button-spinner" aria-hidden="true" />}
                          {language === 'pl' ? 'Sfinalizuj plan działania' : 'Finalize action plan'}
                        </button>
                        </span>
                      </div>
                    )}
                </>
              ) : (
                <p>{t.actionPlanEmpty}</p>
              )}
            </section>

            <section id="action-plan" className="report-section">
              <h2>{t.actionPlanSectionTitle}</h2>
              {normalizedExecutionReport?.stage !== 'plan_generated' ? (
                <p className="report-section-placeholder">
                  {language === 'pl'
                    ? 'Najpierw podejmij kluczowe decyzje, aby wygenerować tę sekcję.'
                    : 'Make your key decisions first to generate this section.'}
                </p>
              ) : hasLeanExecutionReport && normalizedExecutionReport?.action_plan?.length ? (
                (() => {
                  const actions = normalizedExecutionReport.action_plan
                  const normalizeKey = (value: string) =>
                    String(value || '')
                      .toLowerCase()
                      .normalize('NFKD')
                      .replace(/[\u0300-\u036f]/g, '')
                      .replace(/[^a-z0-9\s]/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim()

                  const decisionByNormKey = new Map<string, typeof normalizedExecutionReport.decisions[number]>()
                  normalizedExecutionReport.decisions.forEach((d) => {
                    const norm = normalizeKey(String(d.tradeoff || ''))
                    if (norm) decisionByNormKey.set(norm, d)
                  })
                  const findDecisionBySourceRef = (sourceRef: string | null | undefined) => {
                    const ref = String(sourceRef || '')
                    if (!ref.startsWith('decision:')) return null
                    const parts = ref.split(':')
                    const tradeoffKey = (parts[1] || '').trim()
                    if (!tradeoffKey) return null
                    const exact = decisionByNormKey.get(tradeoffKey) || null
                    if (exact) return exact
                    // Fallback: try closest by containment on normalized strings.
                    const candidates = Array.from(decisionByNormKey.entries())
                    const match = candidates.find(([norm]) => norm.includes(tradeoffKey) || tradeoffKey.includes(norm))
                    return match ? match[1] : null
                  }
                  const findTrizApproachBySourceRef = (sourceRef: string | null | undefined) => {
                    const ref = String(sourceRef || '')
                    if (!ref.startsWith('triz:')) return null
                    const parts = ref.split(':')
                    const cIdx = Number(parts[1] ?? NaN)
                    const aIdx = Number(parts[2] ?? NaN)
                    if (!Number.isFinite(cIdx) || !Number.isFinite(aIdx)) return null
                    const contradiction = reportTriz?.contradictions?.[Math.max(0, Math.floor(cIdx))] ?? null
                    if (!contradiction) return null
                    const renderedApproaches =
                      contradiction.approaches?.length ? contradiction.approaches : contradiction.solutions
                    const approach = renderedApproaches?.[Math.max(0, Math.floor(aIdx))] ?? null
                    return approach
                  }

                  const choiceGroups: Array<{
                    key: string
                    header: string
                    subheader?: string
                    action: (typeof actions)[number]
                  }> = []
                  const otherActions: Array<(typeof actions)[number]> = []

                  actions.forEach((action) => {
                    const sourceType = (action as any)?.source_type as string | null | undefined
                    const sourceRef = (action as any)?.source_ref as string | null | undefined
                    const derivedFromChoice = (action as any)?.derived_from_user_choice as boolean | null | undefined
                    if (sourceType === 'triz') {
                      const approach = findTrizApproachBySourceRef(sourceRef)
                      if (approach) {
                        choiceGroups.push({
                          key: `triz:${sourceRef}`,
                          header: sanitizeReportText(approach.title),
                          subheader: approach.description ? sanitizeReportText(approach.description) : undefined,
                          action,
                        })
                        return
                      }
                    }
                    if (sourceType === 'decision') {
                      const decision = findDecisionBySourceRef(sourceRef)
                      if (decision) {
                        choiceGroups.push({
                          key: `decision:${sourceRef}`,
                          header: sanitizeReportText(decision.tradeoff),
                          action,
                        })
                        return
                      }
                    }
                    if (sourceType === 'analysis' || derivedFromChoice === false) {
                      otherActions.push(action)
                      return
                    }
                    // Unknown source => show under Other.
                    otherActions.push(action)
                  })

                  return (
                    <div className="report-action-plan-grouped">
                      <ul className="report-action-plan-grouped__list">
                        {choiceGroups.map((group, index) => (
                          <li key={`${group.key}-${index}`} className="report-action-plan-grouped__item">
                            <div className="report-action-plan-grouped__header">
                              {group.header}
                            </div>
                            {group.subheader ? (
                              <div className="muted report-action-plan-grouped__subheader">
                                {group.subheader}
                              </div>
                            ) : null}
                            <ul className="report-action-plan-grouped__bullets">
                              <li>{sanitizeReportText(group.action.title)}</li>
                            </ul>
                          </li>
                        ))}
                      </ul>
                      {otherActions.length ? (
                        <div className="report-action-plan-grouped__other">
                          <div className="report-action-plan-grouped__header">{t.actionPlanOtherLabel}</div>
                          <ul className="report-action-plan-grouped__bullets">
                            {otherActions.map((action, idx) => (
                              <li key={`action-other-${idx}`}>{sanitizeReportText(action.title)}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  )
                })()
              ) : (
                <p>{t.actionPlanEmpty}</p>
              )}
            </section>

            <section id="priorities" className="report-section">
              <h2>{t.prioritiesTitle}</h2>
              {normalizedExecutionReport?.stage !== 'plan_generated' ? (
                <p className="report-section-placeholder">
                  {language === 'pl'
                    ? 'Najpierw podejmij kluczowe decyzje, aby wygenerować tę sekcję.'
                    : 'Make your key decisions first to generate this section.'}
                </p>
              ) : hasLeanExecutionReport && normalizedExecutionReport?.priorities?.length ? (
                <ul>
                  {normalizedExecutionReport.priorities.map((item, index) => (
                    <li key={`priority-${index}`}>
                      {sanitizeReportText(item.title)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t.actionPlanEmpty}</p>
              )}
            </section>

            <section id="validation" className="report-section">
              <h2>{t.validationTitle}</h2>
              {normalizedExecutionReport?.stage !== 'plan_generated' ? (
                <p className="report-section-placeholder">
                  {language === 'pl'
                    ? 'Najpierw podejmij kluczowe decyzje, aby wygenerować tę sekcję.'
                    : 'Make your key decisions first to generate this section.'}
                </p>
              ) : hasLeanExecutionReport && normalizedExecutionReport?.validation_loop?.length ? (
                <ul>
                  {normalizedExecutionReport.validation_loop.map((item, index) => (
                    <li key={`validation-${index}`}>
                      {sanitizeReportText(item.check)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t.actionPlanEmpty}</p>
              )}
            </section>


            <section id="appendix" className="report-section">
              <h2>{t.appendices}</h2>
              <div className="report-actions">
                <button type="button" className="primary" onClick={handlePrintReport}>
                  {t.pdfPrint}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => downloadReportCsv(snapshot, summaryItems, language)}
                >
                  {t.exportCsv}
                </button>
              </div>
            </section>
          </>
        ) : (
          <>
        <section id="cover" className="report-section">
          <h2>{t.cover}</h2>
          <div className="report-cover">
            <div className="report-cover-content">
              <p>
                <strong>{t.sessionName}:</strong> {snapshot.sessionName || '—'}
              </p>
              <p>
                <strong>{t.date}:</strong> {snapshot.date || '—'}
              </p>
              <p>
                <strong>{t.userName}:</strong> {snapshot.userName || '—'}
              </p>
            </div>
            <div className="report-cover-logo">
              <img src={reportLogoUrl} alt="MakeMyIdea.Work" />
            </div>
          </div>
        </section>

        <section id="toc" className="report-section">
          <h2>{t.toc}</h2>
          <ol className="report-toc">
            <li>
              <a href="#goal">{t.sessionGoal}</a>
            </li>
            <li>
              <a href="#summary">{t.executiveSummary}</a>
            </li>
            <li>
              <a href="#triz">{t.trizTitle}</a>
            </li>
            <li>
              <a href="#map">{t.perspectiveMap}</a>
            </li>
            <li>
              <a href="#responses">{t.collectedIdeas}</a>
            </li>
            <li>
              <a href="#next">{t.nextSteps}</a>
            </li>
            <li>
              <a href="#appendix">{t.appendices}</a>
            </li>
          </ol>
        </section>

        <section id="goal" className="report-section">
          <h2>{t.sessionGoal}</h2>
          <p>{sessionGoalText}</p>
        </section>

        <section id="summary" className="report-section">
          <h2>{t.executiveSummary}</h2>
          <div className="report-summary-actions">
            {diagnosticsEnabled && summaryUsage && (
              <UsageBadge
                totalTokens={summaryUsage.totalTokens}
                costPln={summaryUsage.costPln}
                model={summaryUsage.model}
                locale={language === 'pl' ? 'pl-PL' : 'en-US'}
              />
            )}
          {summaryStatus === 'running' && <span className="muted">{t.summaryGenerating}</span>}
          {diagnosticsEnabled && !aiSupportEnabled && <span className="muted">{t.aiDisabled}</span>}
          {updateNotice && <span className="muted">{updateNotice}</span>}
        </div>
          {hasNarrativeSummary && (
            <div className="report-summary-block report-summary-block--narrative">
              {cleanedSummary.headline && (
                <p className="report-summary-headline">
                  {renderInlineMarkdown(cleanedSummary.headline)}
                </p>
              )}
              {cleanedSummary.narrative && (
                <p className="report-summary-narrative">
                  {renderInlineMarkdown(cleanedSummary.narrative)}
                </p>
              )}
            </div>
          )}
          {!hasNarrativeSummary && Boolean(cleanedSummary.today) && (
            <div className="report-summary-block">
              <h3>{t.summaryToday}</h3>
              <p>{renderInlineMarkdown(cleanedSummary.today)}</p>
            </div>
          )}
          {!hasNarrativeSummary && Boolean(cleanedSummary.change) && (
            <div className="report-summary-block">
              <h3>{t.summaryChange}</h3>
              <p>{renderInlineMarkdown(cleanedSummary.change)}</p>
            </div>
          )}
          {!hasNarrativeSummary && Boolean(cleanedSummary.product) && (
            <div className="report-summary-block">
              <h3>{t.summaryProduct}</h3>
              <p>{renderInlineMarkdown(cleanedSummary.product)}</p>
            </div>
          )}
          {summaryStatus === 'done' &&
            !hasNarrativeSummary &&
            !cleanedSummary.today &&
            !cleanedSummary.change &&
            !cleanedSummary.product && (
              <div className="report-summary-block">
                <h3>{t.summaryEmptyTitle}</h3>
                <p>{t.summaryEmptyBody}</p>
              </div>
            )}
        </section>

        {renderTrizSection('triz')}

        <section id="map" className="report-section">
          <h2>{t.perspectiveMap}</h2>
          {perspectiveData.total === 0 ? (
            <p className="muted">{perspectiveLabels.empty}</p>
          ) : (
            <>
              <p>{perspectiveLabels.description}</p>
              <div
                className="perspective-bar"
                aria-label={`Mapa perspektyw: ${perspectiveLabels.asIs} ${
                  perspectiveData.percents.asIs
                }%, ${perspectiveLabels.notWorking} ${
                  perspectiveData.percents.notWorking
                }%, ${perspectiveLabels.toBe} ${perspectiveData.percents.toBe}%`}
              >
                <div
                  className="perspective-segment as-is"
                  style={{ width: `${perspectiveData.percents.asIs}%` }}
                  title={`${perspectiveLabels.asIs}: ${perspectiveData.counts.asIs} (${perspectiveData.percents.asIs}%)`}
                >
                </div>
                <div
                  className="perspective-segment not-working"
                  style={{ width: `${perspectiveData.percents.notWorking}%` }}
                  title={`${perspectiveLabels.notWorking}: ${perspectiveData.counts.notWorking} (${perspectiveData.percents.notWorking}%)`}
                >
                </div>
                <div
                  className="perspective-segment to-be"
                  style={{ width: `${perspectiveData.percents.toBe}%` }}
                  title={`${perspectiveLabels.toBe}: ${perspectiveData.counts.toBe} (${perspectiveData.percents.toBe}%)`}
                >
                </div>
              </div>
              <div className="perspective-legend">
                <span className="legend-item as-is">{perspectiveLabels.asIs}</span>
                <span className="legend-item not-working">
                  {perspectiveLabels.notWorking}
                </span>
                <span className="legend-item to-be">{perspectiveLabels.toBe}</span>
              </div>
            </>
          )}
        </section>

        <section id="responses" className="report-section">
          <h2>{t.collectedIdeas}</h2>
          <div className="report-table-wrapper report-table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>{t.tableQuestion}</th>
                  <th>{t.tableEntry}</th>
                  <th>{t.tableLabel}</th>
                </tr>
              </thead>
              <tbody>
                {summaryItems.length === 0 ? (
                  <tr>
                    <td colSpan={3}>{t.noEntries}</td>
                  </tr>
                ) : (
                  summaryItems.filter(Boolean).map((idea) => {
                    const questionText = resolveQuestionText(idea)
                    const isUpdating = Boolean(labelUpdating[idea.id])
                    const labelValue = idea.label ?? ''
                    const hasLabel = Boolean(labelValue)
                    const labelBg = hasLabel
                      ? withAlpha(ENGINE_ENTRY_LABEL_COLORS[labelValue])
                      : '#ffffff'
                    return (
                      <tr key={idea.id}>
                        <td>{questionText}</td>
                        <td>{idea.text || '—'}</td>
                        <td>
                          <label className="engine-entry-label-field">
                            <span className="sr-only">Etykieta wpisu</span>
                            <select
                              data-testid={`report-label-select-${idea.id}`}
                              value={labelValue}
                              disabled={isUpdating}
                              style={{
                                backgroundColor: labelBg,
                                color: '#000000',
                              }}
                              onChange={(event) => {
                                void handleLabelChange(idea, event.target.value)
                              }}
                            >
                              <option value="">{getNoLabelText(language)}</option>
                              {ENGINE_ENTRY_LABELS.map((label) => (
                                <option key={label} value={label}>
                                  {getEntryLabelText(label, language)}
                                </option>
                              ))}
                            </select>
                          </label>
                          {isUpdating && <span className="muted">…</span>}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="next" className="report-section">
          <h2>{t.nextSteps}</h2>
          {!hasRecommendations ? (
            <p>{t.recommendationsEmpty}</p>
          ) : (
            <div className="report-recommendations">
              {recommendations?.based_on_user_ideas.length ? (
                <>
                  <h3>{t.recommendationsIdeasTitle}</h3>
                  <ul>
                    {recommendations.based_on_user_ideas.map((item, idx) => (
                      <li key={`rec-ideas-${idx}`}>
                        <strong>{sanitizeReportText(item.title)}</strong>
                        <div>{sanitizeReportText(item.rationale)}</div>
                        <div>{sanitizeReportText(item.how_to_test)}</div>
                        {item.methods?.length ? (
                          <div>
                            {item.methods.map((m) => sanitizeReportText(m)).join(', ')}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {recommendations?.morphological.length ? (
                <>
                  <h3>{t.recommendationsMorphTitle}</h3>
                  <ul>
                    {recommendations.morphological.map((item, idx) => (
                      <li key={`rec-morph-${idx}`}>
                        <strong>{sanitizeReportText(item.title)}</strong>
                        <div>{sanitizeReportText(item.rationale)}</div>
                        <div>{sanitizeReportText(item.how_to_test)}</div>
                        {item.methods?.length ? (
                          <div>
                            {item.methods.map((m) => sanitizeReportText(m)).join(', ')}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {recommendations?.market_trends.length ? (
                <>
                  <h3>{t.recommendationsTrendsTitle}</h3>
                  <ul>
                    {recommendations.market_trends.map((item, idx) => (
                      <li key={`rec-trends-${idx}`}>
                        <strong>{sanitizeReportText(item.title)}</strong>
                        <div>{sanitizeReportText(item.rationale)}</div>
                        <div>{sanitizeReportText(item.how_to_test)}</div>
                        {item.methods?.length ? (
                          <div>
                            {item.methods.map((m) => sanitizeReportText(m)).join(', ')}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          )}
        </section>

        <section id="appendix" className="report-section">
          <h2>{t.appendices}</h2>
          <div className="report-actions">
            <button type="button" className="primary" onClick={handlePrintReport}>
              {t.pdfPrint}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => downloadReportCsv(snapshot, summaryItems, language)}
            >
              {t.exportCsv}
            </button>
          </div>
        </section>
          </>
        )}
      </main>
    </div>
  )
}
