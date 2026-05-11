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
  billingCurrency?: 'PLN'
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

const normalizeAiSummary = (value: unknown): AiSummary => {
  const empty: AiSummary = { headline: '', narrative: '', today: '', change: '', product: '' }
  if (!value || typeof value !== 'object') return empty
  const current = value as Record<string, unknown>
  const toText = (input: unknown) => (typeof input === 'string' ? input.trim() : '')
  return {
    headline: toText(current.headline),
    narrative: toText(current.narrative),
    today: toText(current.today),
    change: toText(current.change),
    product: toText(current.product),
  }
}

const isGenericRoadmapPhaseTitle = (value: string) => {
  const key = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!key) return true
  return /^(etap|faza|phase|stage)(\s+\d+)?$/.test(key)
}

const buildRoadmapPhaseTitle = (rawTitle: string, index: number, ...sources: string[]) => {
  if (rawTitle && !isGenericRoadmapPhaseTitle(rawTitle)) return rawTitle
  const words = sources
    .find((source) => source.trim())
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 9)
    .join(' ')
  return words ? `Phase ${index + 1} — ${words}` : `Phase ${index + 1} — reduce the next uncertainty`
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
	    roadmap_phases: [],
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
	      (Array.isArray(report.roadmap_phases) && report.roadmap_phases.length > 0) ||
	      (Array.isArray(report.roadmapPhases) && report.roadmapPhases.length > 0) ||
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
            const impactRaw = toText(current.impact)
            const impact =
              impactRaw === 'high' || impactRaw === 'medium' || impactRaw === 'low'
                ? (impactRaw as 'high' | 'medium' | 'low')
                : 'medium'
            return {
              title: toText(current.title),
              why_it_matters: toText(current.why_it_matters),
              impact,
              risk_of_ignoring: toText(current.risk_of_ignoring),
            }
          })
	          .filter((item) => item.title || item.why_it_matters || item.risk_of_ignoring)
	      : [],
	    roadmap_phases: Array.isArray(report.roadmap_phases) || Array.isArray(report.roadmapPhases)
	      ? ((Array.isArray(report.roadmap_phases) ? report.roadmap_phases : report.roadmapPhases) as unknown[])
	          .filter((item) => item && typeof item === 'object')
	          .map((item, index) => {
	            const current = item as Record<string, unknown>
	            const legacyActions = Array.isArray(current.actions)
	              ? (current.actions as unknown[])
	                  .map((action) => {
	                    if (typeof action === 'string') {
	                      return { text: toText(action) }
	                    }
	                    if (!action || typeof action !== 'object') return { text: '' }
	                    const actionRecord = action as Record<string, unknown>
	                    return {
	                      text: toText(actionRecord.text) || toText(actionRecord.action) || toText(actionRecord.step),
	                      validation_gate:
	                        toText(actionRecord.validation_gate) ||
	                        toText(actionRecord.validation) ||
	                        toText(actionRecord.gate) ||
	                        undefined,
	                    }
	                  })
	                  .filter((action) => action.text || action.validation_gate)
	              : []
	            const concreteActions = Array.isArray(current.concrete_actions)
	              ? (current.concrete_actions as unknown[])
	                  .map((action) => {
	                    if (typeof action === 'string') return toText(action)
	                    if (!action || typeof action !== 'object') return ''
	                    const actionRecord = action as Record<string, unknown>
	                    const text = toText(actionRecord.text) || toText(actionRecord.action) || toText(actionRecord.step)
	                    const gate =
	                      toText(actionRecord.validation_gate) ||
	                      toText(actionRecord.validation) ||
	                      toText(actionRecord.gate)
	                    return [text, gate].filter(Boolean).join(' — ')
	                  })
	                  .filter(Boolean)
	              : legacyActions
	                  .map((action) => [action.text, action.validation_gate].filter(Boolean).join(' — '))
	                  .filter(Boolean)
	            const whyThisPhaseMatters =
	              toText(current.why_this_phase_matters) ||
	              toText(current.why) ||
	              toText(current.why_it_matters) ||
	              toText(current.reason) ||
	              toText(current.narrative)
	            const keyRiskOrTradeoff =
	              toText(current.key_risk_or_tradeoff) ||
	              toText(current.risks_reduced) ||
	              toText(current.risks) ||
	              toText(current.uncertainty_reduced) ||
	              toText(current.tradeoff)
	            const validationOrTest =
	              toText(current.validation_or_test) ||
	              toText(current.validation) ||
	              toText(current.test) ||
	              toText(current.exit_criteria)
	            const decisionUnlocked =
	              toText(current.decision_unlocked) ||
	              toText(current.decision) ||
	              toText(current.exit) ||
	              toText(current.gate)
	            const rawPhaseTitle = toText(current.phase_title) || toText(current.title) || toText(current.name)
	            const hasSourceContent =
	              Boolean(rawPhaseTitle && !isGenericRoadmapPhaseTitle(rawPhaseTitle)) ||
	              Boolean(whyThisPhaseMatters) ||
	              Boolean(keyRiskOrTradeoff) ||
	              Boolean(validationOrTest) ||
	              Boolean(decisionUnlocked) ||
	              concreteActions.length > 0
	            const phaseTitle = hasSourceContent
	              ? buildRoadmapPhaseTitle(
	                  rawPhaseTitle,
	                  index,
	                  keyRiskOrTradeoff,
	                  whyThisPhaseMatters,
	                  validationOrTest,
	                  concreteActions[0] || ''
	                )
	              : ''
	            return {
	              phase_title: phaseTitle,
	              why_this_phase_matters: whyThisPhaseMatters,
	              key_risk_or_tradeoff: keyRiskOrTradeoff,
	              concrete_actions: concreteActions,
	              validation_or_test: validationOrTest,
	              decision_unlocked: decisionUnlocked,
	            }
	          })
	          .filter(
	            (phase) =>
	              phase.phase_title ||
	              phase.why_this_phase_matters ||
	              phase.key_risk_or_tradeoff ||
	              phase.concrete_actions.length ||
	              phase.validation_or_test ||
	              phase.decision_unlocked
	          )
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
	            const statusRaw = toText(current.status)
	            const status =
	              statusRaw === 'pending' || statusRaw === 'in_progress' || statusRaw === 'completed'
	                ? (statusRaw as 'pending' | 'in_progress' | 'completed')
	                : 'pending'
	            const technology_options = Array.isArray(current.technology_options)
	              ? (current.technology_options as unknown[])
	                  .map((x) => toText(x))
	                  .filter(Boolean)
	                  .slice(0, 3)
	              : []
	            const step = toText(current.step) || toText(current.title) || toText(current.what_to_do)
	            const details = toText(current.details) || toText(current.what_to_do)
	            const done_when = toText(current.done_when) || toText(current.expected_result)
	            return {
	              step,
	              status,
	              details,
	              technology_options,
	              done_when,
	              ...(source_type ? { source_type } : {}),
	              ...(source_ref ? { source_ref } : {}),
	              ...(derived_from_user_choice != null ? { derived_from_user_choice } : {}),
	            }
	          })
	          .filter((item) => item.step || item.details || item.done_when)
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

const getExecutionReportDebugShape = (value: unknown) => {
  const isObject = Boolean(value && typeof value === 'object' && !Array.isArray(value))
  const report = isObject ? (value as Record<string, unknown>) : null
  const actionPlanRaw = Array.isArray(report?.action_plan)
    ? report.action_plan
    : Array.isArray(report?.actionPlan)
      ? report.actionPlan
      : null
  const roadmapPhasesRaw = Array.isArray(report?.roadmap_phases)
    ? report.roadmap_phases
    : Array.isArray(report?.roadmapPhases)
      ? report.roadmapPhases
      : null
  const validationLoopRaw = Array.isArray(report?.validation_loop)
    ? report.validation_loop
    : Array.isArray(report?.validationLoop)
      ? report.validationLoop
      : null
  return {
    type: typeof value,
    keys: report ? Object.keys(report) : null,
    stage: typeof report?.stage === 'string' ? report.stage : null,
    roadmapPhasesLen: Array.isArray(roadmapPhasesRaw) ? roadmapPhasesRaw.length : null,
    actionPlanLen: Array.isArray(actionPlanRaw) ? actionPlanRaw.length : null,
    validationLoopLen: Array.isArray(validationLoopRaw) ? validationLoopRaw.length : null,
    decisionsLen: Array.isArray(report?.decisions) ? report.decisions.length : null,
    prioritiesLen: Array.isArray(report?.priorities) ? report.priorities.length : null,
    hasTechnologyOptions: Array.isArray(actionPlanRaw)
      ? actionPlanRaw.some(
          (item) =>
            item &&
            typeof item === 'object' &&
            Array.isArray((item as { technology_options?: unknown }).technology_options) &&
            ((item as { technology_options?: unknown[] }).technology_options?.length ?? 0) > 0
        )
      : false,
    hasDoneWhen: Array.isArray(actionPlanRaw)
      ? actionPlanRaw.some(
          (item) =>
            item &&
            typeof item === 'object' &&
            Boolean(String((item as { done_when?: unknown }).done_when || '').trim())
        )
      : false,
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

const sanitizeActionPlanStep = (input: string | null | undefined, language: ReportLang) => {
  const base = sanitizeActionPlanDetail(input)
  if (!base) return ''
  if (language !== 'pl') return base
  // Defensive UI-side cleanup for old reports / mixed-language LLM output.
  const stripped = base.replace(/^(define|design|build|test|action|task)\s+/i, '').trim()
  if (!stripped) return ''
  return stripped[0] === stripped[0].toLowerCase() ? `${stripped[0].toUpperCase()}${stripped.slice(1)}` : stripped
}

const hasLeanExecutionReportContent = (report: ReportExecutionReport | null) => {
  if (!report) return false
  const sectionsWithContent = [
    Array.isArray(report.priorities) && report.priorities.some((item) => sanitizeActionPlanDetail(item.title)),
    Array.isArray(report.roadmap_phases) &&
      report.roadmap_phases.some(
        (phase) =>
          sanitizeActionPlanDetail(phase.phase_title || phase.title) ||
          sanitizeActionPlanDetail(
            phase.why_this_phase_matters ||
              phase.key_risk_or_tradeoff ||
              phase.validation_or_test ||
              phase.decision_unlocked ||
              phase.narrative
          ) ||
          phase.concrete_actions?.some((action) => sanitizeActionPlanDetail(action)) ||
          phase.actions?.some((action) => sanitizeActionPlanDetail(action.text))
      ),
    Array.isArray(report.action_plan) && report.action_plan.some((item) => sanitizeActionPlanDetail(item.step)),
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

const sanitizeFilenamePart = (value: string) => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[\/\\:\*\?"<>|]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'report'
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
  useEffect(() => {
    console.log('[build]', {
      commit: import.meta.env.VITE_COMMIT_SHA,
      buildTime: import.meta.env.VITE_BUILD_TIME,
    })
  }, [])
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
  const trizSelectionVersionRef = useRef(0)
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
  // Billing is PLN-only.
  const handleDecisionSelect = async (decisionIndex: number, selectedOption: 'a' | 'b') => {
    if (!executionReport?.decisions?.[decisionIndex]) return
    if (executionReport.decisions[decisionIndex]?.selected_option === selectedOption) return
    const invalidatesPlan = executionReport.stage === 'plan_generated'
    const nextExecutionReport: ReportExecutionReport = {
      ...executionReport,
      stage: invalidatesPlan ? 'awaiting_decisions' : executionReport.stage,
      decisions: executionReport.decisions.map((item, index) =>
        index === decisionIndex ? { ...item, selected_option: selectedOption } : item
      ),
    }
    const currentReportMeta =
      reportMetaRef.current && typeof reportMetaRef.current === 'object' ? reportMetaRef.current : {}
    reportMetaRef.current = { ...currentReportMeta, execution_report: nextExecutionReport }
    setExecutionReport(nextExecutionReport)
    onReportMetaChange?.({
      execution_report: nextExecutionReport,
      updatedAt: Date.now(),
    })
    if (!client || !reportSessionId) return
	    let userId: string | null = null
	    try {
	      const sessionRes = await client.auth.getSession()
	      userId = sessionRes?.data?.session?.user?.id || null
	      const base = reportMetaRef.current && typeof reportMetaRef.current === 'object' ? reportMetaRef.current : {}
	      const patch = {
	        summary_json: {
	          ...base,
          execution_report: nextExecutionReport,
        },
      }
      const persistPromise = updateReportBySessionId(reportSessionId, {
        summary_json: patch.summary_json,
      })
      pendingDecisionPersistRef.current = persistPromise.then(() => undefined).catch(() => undefined)
      await persistPromise
      reportMetaRef.current = { ...base, execution_report: nextExecutionReport }
	    } catch (error) {
	      console.error('[report][decision-select] persist_failed', {
	        userId,
	        sessionId: reportSessionId,
	        decisionIndex,
        selectedOption,
        patchKeys: ['summary_json'],
        summaryJsonKeys:
          reportMetaRef.current && typeof reportMetaRef.current === 'object'
            ? Object.keys(reportMetaRef.current as any)
            : [],
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const formatBalanceMinor = (minor: number) => {
    const locale = language === 'pl' ? 'pl-PL' : 'en-US'
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.max(0, minor || 0) / 100)
    return `${formatted} PLN`
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
	          .select('price_grosze')
	          .eq('action_key', 'report_update')
	          .maybeSingle()
        if (!cancelled) {
          if (error) {
            setPriceMinor(null)
	          } else {
	            const row = data as {
	              price_grosze?: number | string | null
	            } | null
	            const value = Number(row?.price_grosze)
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
	          .select('action_key,price_grosze')
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
	              }
	            | null
	          const raw = Number(typedRow?.price_grosze ?? NaN)
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
    const trizVersionAtRequestStart = trizSelectionVersionRef.current
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
        if (trizSelectionVersionRef.current === trizVersionAtRequestStart) {
          setReportTriz(record.triz ? normalizeTriz(sanitizeReportPayload(record.triz)) : null)
        }
        setExecutionReport(mergedExecutionReport)
        if (!aiSummary && record.summary) {
          setAiSummary(normalizeAiSummary(sanitizeReportPayload(record.summary)))
        }
        if (!lastSummaryTextHash && record.lastSummaryTextHash) {
          setLastSummaryTextHash(record.lastSummaryTextHash)
        }
	      } catch (error) {
	        console.error('[report] fetchReportBySessionId_failed', {
	          sessionId: reportSessionId,
	          error: error instanceof Error ? error.message : String(error),
	        })
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
        await pendingTrizPersistRef.current
      }
      const sessionRes = client ? await client.auth.getSession() : null
      const token = sessionRes?.data?.session?.access_token || ''
      const payload: any = { sessionId: reportSessionId || sessionId, lang: language }
      if (mode) payload.execution_mode = mode
      if (mode === 'plan_from_decisions' || mode === 'plan_from_decisions_only') {
        const latestReportMeta =
          reportMetaRef.current && typeof reportMetaRef.current === 'object'
            ? (reportMetaRef.current as any)
            : {}
        payload.execution_report = latestReportMeta.execution_report || executionReport
        payload.triz = latestReportMeta.triz || reportTriz
        const trizForPayload = payload.triz ? normalizeTriz(sanitizeReportPayload(payload.triz)) : null
        payload.selected_triz_approaches = Array.isArray(trizForPayload?.contradictions)
          ? trizForPayload.contradictions.flatMap((c: any, contradictionIndex: number) => {
              const rendered = Array.isArray(c?.approaches) && c.approaches.length
                ? c.approaches
                : Array.isArray(c?.solutions)
                  ? c.solutions
                  : []
              const indicesRaw = Array.isArray(c?.selected_approach_indices)
                ? c.selected_approach_indices
                : c?.selected_approach_index != null
                  ? [c.selected_approach_index]
                  : []
              const indices = Array.from(
                new Set<number>(
                  indicesRaw
                    .map((idx: unknown) => (typeof idx === 'number' ? idx : Number(idx)))
                    .filter((idx: number): idx is number => Number.isFinite(idx))
                    .map((idx: number) => Math.max(0, Math.floor(idx)))
                    .filter((idx: number) => idx >= 0 && idx < rendered.length)
                )
              )
              return indices
                .map((approachIndex: number) => {
                  const selected = rendered[approachIndex]
                  if (!selected) return null
                  return {
                    contradiction_index: contradictionIndex,
                    contradiction_title: sanitizeReportText(String(c?.title || '')),
                    approach_index: approachIndex,
                    approach_title: sanitizeReportText(String(selected?.title || '')),
                    approach_description: sanitizeReportText(String(selected?.description || '')),
                  }
                })
                .filter(Boolean)
            })
          : []
        payload.selected_decisions = payload.execution_report
          ? normalizeExecutionReport(sanitizeReportPayload(payload.execution_report)).decisions
              .filter((d) => d.selected_option === 'a' || d.selected_option === 'b')
              .map((d) => ({
                contradiction_index: d.contradiction_index,
                tradeoff: d.tradeoff,
                selected_option: d.selected_option,
                option_a: d.option_a,
                option_b: d.option_b,
                consequence_a: d.consequence_a,
                consequence_b: d.consequence_b,
              }))
          : []
      }

      if (mode === 'plan_from_decisions' || mode === 'plan_from_decisions_only') {
        const exec = payload.execution_report
          ? normalizeExecutionReport(sanitizeReportPayload(payload.execution_report))
          : null
        const decisions = Array.isArray(exec?.decisions) ? exec.decisions : []
        const selectedOptions = decisions.map((d) => (d?.selected_option === 'a' || d?.selected_option === 'b' ? d.selected_option : null))
        const decisionsAllSelected = Boolean(decisions.length && selectedOptions.every((x) => x === 'a' || x === 'b'))
        const triz = payload.triz ? normalizeTriz(sanitizeReportPayload(payload.triz)) : null
        const contradictions = Array.isArray(triz?.contradictions) ? triz.contradictions : []
        const selectedTrizApproaches = Array.isArray(payload.selected_triz_approaches)
          ? payload.selected_triz_approaches
          : []
        const selectedTrizApproachesCount = selectedTrizApproaches.length || contradictions.reduce((sum, c: any) => {
          const indices = Array.isArray(c?.selected_approach_indices)
            ? c.selected_approach_indices
            : c?.selected_approach_index != null
              ? [c.selected_approach_index]
              : []
          return sum + new Set(indices).size
        }, 0)
        const selectedTrizContradictionCount = new Set(
          selectedTrizApproaches.map((item: any) => item?.contradiction_index)
        ).size
        const selectedDecisionDiagnostics = Array.isArray(payload.selected_decisions)
          ? payload.selected_decisions.map((d: any) => {
              const selected = d?.selected_option === 'a' || d?.selected_option === 'b' ? d.selected_option : null
              const selectedOptionText = selected === 'a' ? d?.option_a : selected === 'b' ? d?.option_b : ''
              const selectedConsequence = selected === 'a' ? d?.consequence_a : selected === 'b' ? d?.consequence_b : ''
              const rejectedOptionText = selected === 'a' ? d?.option_b : selected === 'b' ? d?.option_a : ''
              const rejectedConsequence = selected === 'a' ? d?.consequence_b : selected === 'b' ? d?.consequence_a : ''
              return {
                contradiction_index: d?.contradiction_index ?? null,
                tradeoff: d?.tradeoff ?? '',
                selected_option: selected,
                selected_option_text: selectedOptionText || '',
                selected_option_consequence: selectedConsequence || '',
                rejected_option_text: rejectedOptionText || '',
                rejected_option_consequence: rejectedConsequence || '',
              }
            })
          : []
        console.log('[REPORT FINALIZE DEBUG][frontend][before-post]', {
          reportVariant,
          execution_mode: mode,
          sessionId: reportSessionId || sessionId,
          hasSnapshotExecutionReport: Boolean(snapshot.reportMeta?.execution_report),
          execution_report_stage: exec?.stage ?? null,
          decisionsCount: decisions.length,
          selectedDecisionsCount: selectedOptions.filter((x) => x === 'a' || x === 'b').length,
          selectedOptions,
          selectedDecisionDiagnostics,
          decisionsAllSelected,
          hasTriz: Boolean(triz),
          trizContradictionsCount: contradictions.length,
          selectedTrizContradictionCount,
          selectedTrizApproachesCount,
          selectedTrizApproachTitles: selectedTrizApproaches.map((item: any) => item?.approach_title).filter(Boolean),
          trizSelectedApproachIndices: contradictions.map((c, idx) => ({
            contradictionIndex: idx,
            selected_approach_indices: Array.isArray((c as any)?.selected_approach_indices)
              ? (c as any).selected_approach_indices
              : (c as any)?.selected_approach_index != null
                ? [(c as any).selected_approach_index]
                : [],
          })),
          payloadKeys: Object.keys(payload),
        })
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

      const getExecutionReportShape = getExecutionReportDebugShape

      const coerceExecutionReportPayload = (value: any) => {
        if (!value || typeof value !== 'object') return null
        if (Array.isArray(value)) return null
        const v: any = value
        const stage =
          typeof v.stage === 'string'
            ? v.stage
            : typeof v.execution_report_stage === 'string'
              ? v.execution_report_stage
              : null
        return {
	          ...v,
	          ...(stage ? { stage } : {}),
	          ...(v.roadmap_phases == null && Array.isArray(v.roadmapPhases) ? { roadmap_phases: v.roadmapPhases } : {}),
	          ...(v.action_plan == null && Array.isArray(v.actionPlan) ? { action_plan: v.actionPlan } : {}),
          ...(v.validation_loop == null && Array.isArray(v.validationLoop) ? { validation_loop: v.validationLoop } : {}),
        }
      }

      const isExecutionReportAcceptable = (value: any) => {
        const shape = getExecutionReportShape(value)
        const stage = (shape.stage || '').toLowerCase()
	        if (stage === 'plan_generated') return true
	        if ((shape.roadmapPhasesLen ?? 0) > 0) return true
	        if ((shape.actionPlanLen ?? 0) > 0) return true
        if ((shape.decisionsLen ?? 0) > 0) return true
        return false
      }

      const extractExecutionReportFromUpdateResponse = (payload: any) => {
        if (!payload || typeof payload !== 'object') return { executionReport: null, path: 'none' }
        const report = payload.report && typeof payload.report === 'object' ? payload.report : null
        const candidates: Array<{ path: string; value: any }> = [
          { path: 'execution_report', value: (payload as any).execution_report },
          { path: 'report.summary_json.execution_report', value: (report as any)?.summary_json?.execution_report },
        ]

        for (const candidate of candidates) {
          const value = candidate.value
          if (!value || typeof value !== 'object') continue
          const coerced = coerceExecutionReportPayload(value)
          if (!coerced) continue
          if (!isExecutionReportAcceptable(coerced)) continue
          return {
            executionReport: normalizeExecutionReport(sanitizeReportPayload(coerced)),
            path: candidate.path,
          }
        }

        return { executionReport: null, path: 'none' }
      }

      if (mode === 'plan_from_decisions' || mode === 'plan_from_decisions_only') {
        const execution = responsePayload?.execution && typeof responsePayload.execution === 'object' ? responsePayload.execution : null
        const report = responsePayload?.report && typeof responsePayload.report === 'object' ? responsePayload.report : null
        const extracted = extractExecutionReportFromUpdateResponse(responsePayload)
        const executionReportReturned = extracted.executionReport
        const detectedExecutionPath = extracted.path
        console.log('[REPORT FINALIZE DEBUG][frontend][after-post][shape]', {
          execution_report: getExecutionReportShape(responsePayload?.execution_report),
          execution: getExecutionReportShape(responsePayload?.execution),
          report_summary_execution_report: getExecutionReportShape(report?.summary_json?.execution_report),
        })
        console.log('[REPORT FINALIZE DEBUG][frontend][after-post]', {
          httpStatus: response.status,
          responseOk: response.ok,
          payloadOk: Boolean(responsePayload?.ok),
          responseKeys: responsePayload && typeof responsePayload === 'object' ? Object.keys(responsePayload) : null,
          planGenerated: responsePayload?.planGenerated ?? execution?.planGenerated ?? null,
          planSkippedReason: responsePayload?.planSkippedReason ?? execution?.planSkippedReason ?? null,
          detectedExecutionPath,
          returnedExecutionReportStage: executionReportReturned?.stage ?? null,
	          returnedActionPlanLen: Array.isArray(executionReportReturned?.action_plan)
	            ? executionReportReturned?.action_plan.length
	            : null,
	          returnedRoadmapPhasesLen: Array.isArray(executionReportReturned?.roadmap_phases)
	            ? executionReportReturned?.roadmap_phases.length
	            : null,
          returnedDecisionsLen: Array.isArray(executionReportReturned?.decisions)
            ? executionReportReturned?.decisions.length
            : null,
          error: responsePayload?.error ?? null,
          message: responsePayload?.message ?? null,
        })
      }
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
	        if (
	          mode === 'plan_from_decisions_only' &&
	          (responsePayload?.error === 'report_action_plan_failed' ||
	            responsePayload?.planSkippedReason === 'REPORT_ACTION_PLAN_FAILED' ||
	            responsePayload?.execution?.planSkippedReason === 'REPORT_ACTION_PLAN_FAILED')
	        ) {
	          setUpdateNotice(
	            typeof responsePayload?.message === 'string' && responsePayload.message.trim()
	              ? responsePayload.message
	              : language === 'pl'
	                ? 'Aktualizacja planu działania nie powiodła się. Spróbuj ponownie.'
	                : 'Plan update failed. Try again.'
	          )
	          return
	        }
	        setUpdateNotice(t.labelSaveError)
	        return
	      }
	      if (
	        mode === 'plan_from_decisions_only' &&
	        (responsePayload?.planGenerated === false || responsePayload?.execution?.planGenerated === false)
	      ) {
	        setUpdateNotice(
	          language === 'pl'
	            ? 'Aktualizacja planu działania nie powiodła się. Spróbuj ponownie.'
	            : 'Plan update failed. Try again.'
	        )
	        return
	      }
	      if (mode === 'plan_from_decisions' || mode === 'plan_from_decisions_only') {
        const extracted = extractExecutionReportFromUpdateResponse(responsePayload)
        const executionReportReturned = extracted.executionReport
        if (executionReportReturned) {
          console.log('[REPORT FINALIZE DEBUG][frontend][post-success] apply_execution_report', {
            path: extracted.path,
            stage: executionReportReturned.stage ?? null,
            roadmapPhasesLen: Array.isArray(executionReportReturned.roadmap_phases)
              ? executionReportReturned.roadmap_phases.length
              : null,
            actionPlanLen: Array.isArray(executionReportReturned.action_plan)
              ? executionReportReturned.action_plan.length
              : null,
            validationLoopLen: Array.isArray(executionReportReturned.validation_loop)
              ? executionReportReturned.validation_loop.length
              : null,
            decisionsLen: Array.isArray(executionReportReturned.decisions)
              ? executionReportReturned.decisions.length
              : null,
          })
          setExecutionReport(executionReportReturned)
          onReportMetaChange?.({
            execution_report: executionReportReturned,
            updatedAt: Date.now(),
          })
          const base =
            reportMetaRef.current && typeof reportMetaRef.current === 'object' ? reportMetaRef.current : {}
          reportMetaRef.current = { ...base, execution_report: executionReportReturned }
        } else if (responsePayload?.planGenerated || responsePayload?.execution?.planGenerated) {
          console.log('[REPORT FINALIZE DEBUG][frontend][post-success] missing_execution_report_refetch', {
            sessionId: reportSessionId || sessionId,
          })
          try {
            const record = await fetchReportBySessionId(reportSessionId || sessionId)
            const exec = record?.executionReport
              ? normalizeExecutionReport(sanitizeReportPayload(record.executionReport))
              : null
            console.log('[REPORT FINALIZE DEBUG][frontend][post-success] refetch_result', {
              fetched: Boolean(record),
              reportId: record?.id ?? null,
              stage: exec?.stage ?? null,
              roadmapPhasesLen: Array.isArray(exec?.roadmap_phases) ? exec.roadmap_phases.length : null,
              actionPlanLen: Array.isArray(exec?.action_plan) ? exec.action_plan.length : null,
              validationLoopLen: Array.isArray(exec?.validation_loop) ? exec.validation_loop.length : null,
              decisionsLen: Array.isArray(exec?.decisions) ? exec.decisions.length : null,
              prioritiesLen: Array.isArray(exec?.priorities) ? exec.priorities.length : null,
              hasTechnologyOptions: getExecutionReportDebugShape(exec).hasTechnologyOptions,
              hasDoneWhen: getExecutionReportDebugShape(exec).hasDoneWhen,
            })
            if (record) {
              applyReportRecord(record, { authoritativeExecutionReport: true })
              setSummaryStatus('done')
            }
            if (exec) {
              setExecutionReport(exec)
              onReportMetaChange?.({
                execution_report: exec,
                updatedAt: Date.now(),
              })
              const base =
                reportMetaRef.current && typeof reportMetaRef.current === 'object' ? reportMetaRef.current : {}
              reportMetaRef.current = { ...base, execution_report: exec }
            }
          } catch (error) {
            console.error('[REPORT FINALIZE DEBUG][frontend][post-success] refetch_failed', {
              sessionId: reportSessionId || sessionId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
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
        if (mode === 'plan_from_decisions' || mode === 'plan_from_decisions_only') {
          const exec = record?.executionReport
            ? normalizeExecutionReport(sanitizeReportPayload(record.executionReport))
            : null
          console.log('[REPORT FINALIZE DEBUG][frontend][after-refresh]', {
            fetched: Boolean(record),
            sessionId: reportSessionId,
            reportId: record?.id ?? null,
            updatedAt: record?.updatedAt ?? null,
            sourceUpdatedAt: record?.sourceUpdatedAt ?? null,
            execution_report_stage: exec?.stage ?? null,
            roadmapPhasesLen: Array.isArray(exec?.roadmap_phases) ? exec.roadmap_phases.length : null,
            actionPlanLen: Array.isArray(exec?.action_plan) ? exec.action_plan.length : null,
            decisionsLen: Array.isArray(exec?.decisions) ? exec.decisions.length : null,
            validationLoopLen: Array.isArray(exec?.validation_loop) ? exec.validation_loop.length : null,
            prioritiesLen: Array.isArray(exec?.priorities) ? exec.priorities.length : null,
            hasTechnologyOptions: getExecutionReportDebugShape(exec).hasTechnologyOptions,
            hasDoneWhen: getExecutionReportDebugShape(exec).hasDoneWhen,
          })
        }
        if (record) {
          applyReportRecord(record, {
            authoritativeExecutionReport: mode === 'plan_from_decisions' || mode === 'plan_from_decisions_only',
          })
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
    return formatBalanceMinor(minor || 0)
  }

  const applyReportRecord = (
    record: Awaited<ReturnType<typeof fetchReportBySessionId>>,
    options: { authoritativeExecutionReport?: boolean } = {}
  ) => {
    if (!record) return
    const normalized = validateAndNormalizeReport({
      summary: record.summary,
      ideas: record.ideas,
      recommendations: record.recommendations,
      triz: record.triz,
      execution_report: record.executionReport,
    })
    const sanitized = sanitizeReportPayload(normalized)
    const canonicalExecutionReport = record.executionReport
      ? normalizeExecutionReport(sanitizeReportPayload(record.executionReport))
      : null
    const mergedExecutionReport = options.authoritativeExecutionReport
      ? canonicalExecutionReport
      : mergeExecutionDecisionSelections(
          canonicalExecutionReport,
          executionReport ??
            (snapshot.reportMeta?.execution_report
              ? normalizeExecutionReport(sanitizeReportPayload(snapshot.reportMeta.execution_report))
              : null)
        )
    if (options.authoritativeExecutionReport && !canonicalExecutionReport && executionReport) {
      console.log('[REPORT FINALIZE DEBUG][frontend][stale-state-cleared]', {
        reason: 'canonical_refetch_missing_execution_report',
        previous: getExecutionReportDebugShape(executionReport),
      })
    }
    if (
      options.authoritativeExecutionReport &&
      canonicalExecutionReport?.stage === 'plan_generated' &&
      (canonicalExecutionReport.roadmap_phases?.length ?? 0) === 0 &&
      (canonicalExecutionReport.action_plan?.length ?? 0) === 0 &&
      executionReport &&
      ((executionReport.roadmap_phases?.length ?? 0) > 0 || (executionReport.action_plan?.length ?? 0) > 0)
    ) {
      console.log('[REPORT FINALIZE DEBUG][frontend][stale-state-cleared]', {
        reason: 'canonical_refetch_empty_generated_plan',
        previous: getExecutionReportDebugShape(executionReport),
        canonical: getExecutionReportDebugShape(canonicalExecutionReport),
      })
    }
    reportMetaRef.current = {
      ...sanitized,
      execution_report: options.authoritativeExecutionReport
        ? canonicalExecutionReport
        : sanitized.execution_report,
    }
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
      execution_report: options.authoritativeExecutionReport
        ? canonicalExecutionReport
        : sanitized.execution_report,
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
          }
        : executionReport

      trizSelectionVersionRef.current += 1
      setReportTriz(nextTriz)
      if (invalidatesPlan && nextExecutionReport) {
        setExecutionReport(nextExecutionReport)
      }
      const nextReportMeta = {
        ...base,
        triz: nextTriz,
        ...(invalidatesPlan && nextExecutionReport ? { execution_report: nextExecutionReport } : {}),
      }
      reportMetaRef.current = nextReportMeta
      onReportMetaChange?.({
        ...nextReportMeta,
        updatedAt: Date.now(),
      })
      if (!client || !reportSessionId) return
      const previousPersist = pendingTrizPersistRef.current ?? Promise.resolve()
      const persistPromise = (async () => {
        await previousPersist
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
              mode: has ? 'remove' : 'add',
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
        reportMetaRef.current = nextReportMeta
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
  const hasTriz = Boolean(normalizedTriz?.contradictions.length)
  const normalizedExecutionReport = useMemo(
    () => (executionReport ? normalizeExecutionReport(sanitizeReportPayload(executionReport)) : null),
    [executionReport]
  )
  const hasLeanExecutionReport = hasLeanExecutionReportContent(normalizedExecutionReport)
  const hasActionPlanData =
    normalizedExecutionReport &&
    ((normalizedExecutionReport?.roadmap_phases?.length ?? 0) > 0 ||
      (normalizedExecutionReport?.action_plan?.length ?? 0) > 0 ||
      (normalizedExecutionReport?.priorities?.length ?? 0) > 0 ||
      (normalizedExecutionReport?.validation_loop?.length ?? 0) > 0)
  const executionReportPlanRenderable = Boolean(hasActionPlanData || hasLeanExecutionReport)
  const executionReportRenderBranch = useMemo<'roadmap_phases' | 'legacy_action_plan' | 'empty'>(() => {
    if (
      (executionReportPlanRenderable || hasLeanExecutionReport) &&
      Array.isArray(normalizedExecutionReport?.roadmap_phases) &&
      normalizedExecutionReport.roadmap_phases.length
    ) {
      return 'roadmap_phases'
    }
    if (
      (executionReportPlanRenderable || hasLeanExecutionReport) &&
      Array.isArray(normalizedExecutionReport?.action_plan) &&
      normalizedExecutionReport.action_plan.length
    ) {
      return 'legacy_action_plan'
    }
    return 'empty'
  }, [normalizedExecutionReport, executionReportPlanRenderable, hasLeanExecutionReport])
  useEffect(() => {
    if (reportVariant !== 'action') return
    const actionPlan = Array.isArray(normalizedExecutionReport?.action_plan)
      ? normalizedExecutionReport.action_plan
      : []
    console.info('[REPORT RENDER DEBUG][execution]', {
      stage: normalizedExecutionReport?.stage ?? null,
      roadmapPhasesLen: Array.isArray(normalizedExecutionReport?.roadmap_phases)
        ? normalizedExecutionReport?.roadmap_phases.length
        : null,
	      actionPlanLen: Array.isArray(normalizedExecutionReport?.action_plan)
	        ? normalizedExecutionReport?.action_plan.length
	        : null,
      validationLoopLen: Array.isArray(normalizedExecutionReport?.validation_loop)
        ? normalizedExecutionReport?.validation_loop.length
        : null,
      decisionsLen: Array.isArray(normalizedExecutionReport?.decisions)
        ? normalizedExecutionReport.decisions.length
        : null,
      renderBranch: executionReportRenderBranch,
      hasTechnologyOptions: actionPlan.some(
        (item) => Array.isArray(item.technology_options) && item.technology_options.length > 0
      ),
      hasDoneWhen: actionPlan.some((item) => Boolean(String(item.done_when || '').trim())),
      prioritiesLen: Array.isArray(normalizedExecutionReport?.priorities)
        ? normalizedExecutionReport?.priorities.length
        : null,
      hasLeanExecutionReport,
      renderableByStage: executionReportPlanRenderable,
      hiddenByLeanGate: Boolean(executionReportPlanRenderable && !hasLeanExecutionReport),
      source: 'executionReport state used by render',
    })
  }, [
    reportVariant,
    normalizedExecutionReport,
    hasLeanExecutionReport,
    executionReportPlanRenderable,
    executionReportRenderBranch,
  ])
  useEffect(() => {
    if (reportVariant !== 'action') return
    console.log('[REPORT RENDER DEBUG][execution][branch]', {
      branch:
        executionReportRenderBranch === 'roadmap_phases'
          ? 'roadmap_phases branch'
          : executionReportRenderBranch === 'legacy_action_plan'
            ? 'legacy action_plan branch'
            : 'fallback/empty branch',
      renderBranch: executionReportRenderBranch,
    })
  }, [reportVariant, executionReportRenderBranch])
  useEffect(() => {
    if (reportVariant !== 'action') return
    const shape = getExecutionReportDebugShape(normalizedExecutionReport)
    if (
      shape.stage === 'plan_generated' &&
      shape.roadmapPhasesLen === 0 &&
      (shape.actionPlanLen ?? 0) > 0 &&
      (shape.hasTechnologyOptions || shape.hasDoneWhen)
    ) {
      console.warn('[REPORT RENDER WARNING] rendering legacy generated checklist', {
        sessionId: reportSessionId,
        reportId: null,
        ...shape,
      })
    }
  }, [reportVariant, normalizedExecutionReport, reportSessionId])
  const decisionsAllSelected = Boolean(
    normalizedExecutionReport?.decisions?.length &&
      normalizedExecutionReport.decisions.every(
        (d) => d.selected_option === 'a' || d.selected_option === 'b'
      )
  )
  const needsActionPlanBootstrap =
    reportVariant === 'action' && !normalizedExecutionReport?.decisions?.length
  const hasRenderableActionPlanContent = Boolean(hasActionPlanData || hasLeanExecutionReport)
  const isActionPlanOutdated =
    Boolean(hasActionPlanData && normalizedExecutionReport?.stage !== 'plan_generated')
  const hasExistingActionPlanContent =
    !!(
      normalizedExecutionReport &&
      ((normalizedExecutionReport?.roadmap_phases?.length ?? 0) +
        (normalizedExecutionReport?.action_plan?.length ?? 0) +
        (normalizedExecutionReport?.priorities?.length ?? 0) +
        (normalizedExecutionReport?.validation_loop?.length ?? 0) >
        0)
    )
  const trizApproachSelectionStats = useMemo(() => {
    if (!normalizedTriz) {
      return { selected: 0, total: 0 }
    }
    return normalizedTriz.contradictions.reduce(
      (acc, item) => {
        const options = item.approaches?.length ? item.approaches : item.solutions
        const optionsCount = Array.isArray(options) ? options.length : 0
        const selectedCount = Array.isArray(item.selected_approach_indices)
          ? item.selected_approach_indices.length
          : 0
        return {
          selected: acc.selected + selectedCount,
          total: acc.total + optionsCount,
        }
      },
      { selected: 0, total: 0 }
    )
  }, [normalizedTriz])
  const approachSelectionSuffix = ` (${
    language === 'pl'
      ? `wybrałeś ${trizApproachSelectionStats.selected} z ${trizApproachSelectionStats.total} możliwych podejść z sekcji kluczowych sprzeczności`
      : `selected ${trizApproachSelectionStats.selected} of ${trizApproachSelectionStats.total} available approaches in the key contradictions section`
  })`
  const renderActionPlanButtonLabel = (language === 'pl'
    ? hasExistingActionPlanContent
      ? `Zaktualizuj plan działania${approachSelectionSuffix}`
      : 'Sfinalizuj plan działania'
    : hasExistingActionPlanContent
      ? `Update action plan${approachSelectionSuffix}`
      : 'Finalize action plan')
  const updateCtaLabel = reportIsOutdated
    ? language === 'pl'
      ? 'Aktualizuj Plan działania - Pracownia Pomysłu została zmodyfikowana'
      : 'Update action plan - Idea Studio has been modified'
    : t.reportUpdate
  const updateDisabled =
    isReportUpdating ||
    (!reportIsOutdated && !needsActionPlanBootstrap)

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
                  : formatBalanceMinor(balanceMinor)}
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
                updateDisabled
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
                disabled={updateDisabled}
                disabledTooltip={
                  !reportIsOutdated && !needsActionPlanBootstrap && !isReportUpdating
                    ? t.reportUpdateDisabledTooltip
                    : undefined
                }
                  className="report-update-btn--wide-left"
                  metaLayout="below"
                onClick={() => void handleUpdateReport()}
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
                          {renderActionPlanButtonLabel}
                        </button>
                        </span>
                      </div>
                    )}
                </>
              ) : (
                <p>{t.actionPlanEmpty}</p>
              )}
            </section>

            <section
              id="action-plan"
              className={`report-section${isActionPlanOutdated ? ' report-section--action-plan-stale' : ''}`}
            >
              <h2>{t.actionPlanSectionTitle}</h2>
              {!hasRenderableActionPlanContent ? (
                <p className="report-section-placeholder">
                  {language === 'pl'
                    ? 'Najpierw podejmij kluczowe decyzje, aby wygenerować tę sekcję.'
                    : 'Make your key decisions first to generate this section.'}
                </p>
		              ) : (executionReportPlanRenderable || hasLeanExecutionReport) &&
		                  Array.isArray((normalizedExecutionReport as any)?.roadmap_phases) &&
		                  (normalizedExecutionReport as any).roadmap_phases.length ? (
		                (() => {
		                  const phases = (normalizedExecutionReport as any).roadmap_phases as any[]
		                  const safe = (value: unknown) => sanitizeReportText(String(value || '').trim())
		                  const stripRoadmapAdvisoryCues = (value: string) => {
		                    let text = value
		                    const leadingCuePattern =
		                      /^(?:Największa niewiadoma|Szukasz sygnału|Jeśli to się potwierdzi|Main uncertainty|Look for this signal|If that holds)\s*:\s*/iu
		                    text = text.replace(leadingCuePattern, '').replace(/\s+/gu, ' ').trim()
		                    const nextCuePattern =
		                      /\s+(?:Największa niewiadoma|Szukasz sygnału|Jeśli to się potwierdzi|Main uncertainty|Look for this signal|If that holds)\s*:/iu
		                    const nextCueMatch = text.match(nextCuePattern)
		                    if (nextCueMatch?.index != null && nextCueMatch.index > 0) {
		                      text = text.slice(0, nextCueMatch.index).trim()
		                    }
		                    text = text.replace(leadingCuePattern, '').replace(/\s+/gu, ' ').trim()
		                    return text
		                  }
		                  const formatRoadmapAdvisoryLine = (value: unknown) => {
		                    const text = stripRoadmapAdvisoryCues(safe(value))
		                    if (/^Czy\s/u.test(text) && !/\?\s*$/.test(text)) {
		                      return `${text.replace(/[.!:;]\s*$/u, '')}?`
		                    }
		                    return text
		                  }
		                  const formatRoadmapActionBullet = (value: unknown) => {
		                    const text = safe(value)
		                    const leadingInfinitives: Array<[string, string]> = [
		                      ['Zaprojektować', 'Zaprojektuj'],
		                      ['Przetestować', 'Przetestuj'],
		                      ['Ocenić', 'Oceń'],
		                      ['Zbudować', 'Zbuduj'],
		                      ['Zmierzyć', 'Zmierz'],
		                      ['Porównać', 'Porównaj'],
		                      ['Sprawdzić', 'Sprawdź'],
		                      ['Wybrać', 'Wybierz'],
		                    ]
		                    for (const [infinitive, imperative] of leadingInfinitives) {
		                      const prefix = text.slice(0, infinitive.length)
		                      const boundary = text.length === infinitive.length || /\s/u.test(text.charAt(infinitive.length))
		                      if (boundary && prefix.toLocaleLowerCase('pl-PL') === infinitive.toLocaleLowerCase('pl-PL')) {
		                        return `${imperative}${text.slice(infinitive.length)}`
		                      }
		                    }
		                    return text
		                  }
		                  return (
		                    <ol className="report-action-plan-grouped__list">
		                      {phases.map((phase, idx) => {
		                        const title =
		                          safe(phase?.phase_title || phase?.title) ||
		                          (language === 'pl'
		                            ? `Etap ${idx + 1} — ogranicz kolejną niewiadomą`
		                            : `Phase ${idx + 1} — reduce the next uncertainty`)
		                        const why = safe(phase?.why_this_phase_matters || phase?.why || phase?.narrative)
		                        const risk = formatRoadmapAdvisoryLine(phase?.key_risk_or_tradeoff || phase?.risks_reduced)
		                        const validation = formatRoadmapAdvisoryLine(phase?.validation_or_test || phase?.exit_criteria)
		                        const decision = formatRoadmapAdvisoryLine(phase?.decision_unlocked || phase?.decision)
		                        const advisoryItems = [
		                          risk
		                            ? {
		                                cue: language === 'pl' ? 'Największa niewiadoma:' : 'Main uncertainty:',
		                                text: risk,
		                              }
		                            : null,
		                          validation
		                            ? {
		                                cue: language === 'pl' ? 'Szukasz sygnału:' : 'Look for this signal:',
		                                text: validation,
		                              }
		                            : null,
		                          decision
		                            ? {
		                                cue: language === 'pl' ? 'Jeśli to się potwierdzi:' : 'If that holds:',
		                                text: decision,
		                              }
		                            : null,
		                        ].filter((item): item is { cue: string; text: string } => Boolean(item))
		                        const actions = Array.isArray(phase?.concrete_actions)
		                          ? phase.concrete_actions
		                          : Array.isArray(phase?.actions)
		                            ? phase.actions
		                            : []
		                        const bullets = actions
		                          .map((a: any) => {
		                            if (typeof a === 'string') return formatRoadmapActionBullet(a)
		                            const text = formatRoadmapActionBullet(a?.text || a)
		                            const gate = safe(a?.validation_gate)
		                            if (!text && !gate) return ''
		                            return gate ? `${text} — ${gate}`.trim() : text
		                          })
		                          .filter(Boolean)
                              .slice(0, 3)
		                        return (
		                          <li key={`roadmap-phase-${idx}`} className="report-action-plan-grouped__item">
		                            <div className="report-action-plan-grouped__header">
		                              <span className="report-action-plan-grouped__index">{idx + 1}</span>
		                              <span>{title}</span>
		                            </div>
		                            {why ? (
		                              <p className="report-action-plan-grouped__rationale">{why}</p>
		                            ) : null}
		                            {bullets.length ? (
		                              <div className="report-action-plan-grouped__actions">
		                                <ul className="report-action-plan-grouped__moves">
		                                  {bullets.map((b: string, bi: number) => (
		                                    <li key={`roadmap-phase-${idx}-a-${bi}`}>{b}</li>
		                                  ))}
		                                </ul>
		                              </div>
		                            ) : null}
		                            {advisoryItems.length ? (
		                              <div className="report-action-plan-grouped__memo">
		                                {advisoryItems.map((item, advisoryIdx) => (
		                                  <p key={`roadmap-phase-${idx}-advisory-${advisoryIdx}`}>
		                                    <span className="report-action-plan-grouped__memo-cue">{item.cue}</span>{' '}
		                                    {item.text}
		                                  </p>
		                                ))}
		                              </div>
		                            ) : null}
		                          </li>
		                        )
		                      })}
		                    </ol>
		                  )
		                })()
		              ) : (executionReportPlanRenderable || hasLeanExecutionReport) && normalizedExecutionReport?.action_plan?.length ? (
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

	                  const linkedLabel = t.actionPlanLinkedToLabel
	                  const buildLinkedText = (action: (typeof actions)[number]) => {
	                    const sourceType = (action as any)?.source_type as string | null | undefined
	                    const sourceRef = (action as any)?.source_ref as string | null | undefined
	                    if (!sourceType || !sourceRef) return ''
	                    if (sourceType === 'decision') {
	                      const decision = findDecisionBySourceRef(sourceRef)
	                      return decision?.tradeoff ? `${linkedLabel}: ${sanitizeReportText(decision.tradeoff)}` : ''
	                    }
	                    if (sourceType === 'triz') {
	                      const approach = findTrizApproachBySourceRef(sourceRef)
	                      // Do NOT render approach title/description as headers; keep as small metadata only.
	                      return approach?.title ? `${linkedLabel}: ${sanitizeReportText(approach.title)}` : ''
	                    }
	                    return ''
	                  }

	                  return (
	                    <ul className="report-action-plan-list">
	                      {actions.map((action, idx) => {
	                        const step = sanitizeActionPlanStep(action.step, language)
	                        if (!step) return null
	                        const linked = buildLinkedText(action)
	                        const details = sanitizeActionPlanDetail(action.details)
	                        const doneWhen = sanitizeActionPlanDetail(action.done_when)
	                        const tech = Array.isArray(action.technology_options)
	                          ? action.technology_options.map((x) => sanitizeActionPlanDetail(x)).filter(Boolean)
	                          : []
	                        return (
	                          <li key={`action-plan-${idx}`} className="report-action-plan-list__item">
	                            <div className="report-action-plan-list__step">{step}</div>
	                            {linked ? <div className="muted report-action-plan-list__meta">{linked}</div> : null}
	                            {details ? <div className="muted report-action-plan-list__meta">{details}</div> : null}
	                            {doneWhen ? <div className="muted report-action-plan-list__meta">{doneWhen}</div> : null}
	                            {tech.length ? (
	                              <div className="muted report-action-plan-list__meta">
	                                {tech.join(' · ')}
	                              </div>
	                            ) : null}
	                          </li>
	                        )
	                      })}
	                    </ul>
	                  )
	                })()
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
              <p>{renderInlineMarkdown(cleanedSummary.today || '')}</p>
            </div>
          )}
          {!hasNarrativeSummary && Boolean(cleanedSummary.change) && (
            <div className="report-summary-block">
              <h3>{t.summaryChange}</h3>
              <p>{renderInlineMarkdown(cleanedSummary.change || '')}</p>
            </div>
          )}
          {!hasNarrativeSummary && Boolean(cleanedSummary.product) && (
            <div className="report-summary-block">
              <h3>{t.summaryProduct}</h3>
              <p>{renderInlineMarkdown(cleanedSummary.product || '')}</p>
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
