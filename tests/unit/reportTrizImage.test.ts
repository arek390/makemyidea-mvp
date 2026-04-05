import { describe, expect, it } from 'vitest'
import {
  buildTrizImageRollbackUpdate,
  classifyTrizFormatState,
} from '../../src/lib/server/handlers/reportUpdate.js'

describe('classifyTrizFormatState', () => {
  it('accepts legacy string[] solutions without marking the report invalid', () => {
    const summaryJson = {
      triz: {
        contradictions: [
          {
            solutions: ['Legacy solution'],
          },
        ],
      },
    }

    expect(classifyTrizFormatState(summaryJson, 0, 0)).toEqual({
      ok: true,
      rawSolution: 'Legacy solution',
      legacy: true,
    })
  })

  it('marks malformed TRIZ solutions shape as invalid report format', () => {
    const summaryJson = {
      triz: {
        contradictions: [
          {
            solutions: { broken: true },
          },
        ],
      },
    }

    expect(classifyTrizFormatState(summaryJson, 0, 0)).toEqual({
      ok: false,
      reason: 'solutions_not_array',
    })
  })
})

describe('buildTrizImageRollbackUpdate', () => {
  it('restores the full original summary_json and original updated_at on billing rollback', () => {
    const originalSummary = {
      summary: { today: 'a', change: 'b', product: 'c' },
      triz: {
        contradictions: [
          {
            title: 'x',
            solutions: [
              {
                title: 'old',
                description: 'existing',
                image: {
                  status: 'ready',
                  public_url: 'https://old.example/image.png',
                },
              },
            ],
          },
        ],
      },
    }

    expect(
      buildTrizImageRollbackUpdate({
        summary_json: originalSummary,
        updated_at: '2026-04-05T12:00:00.000Z',
      })
    ).toEqual({
      summary_json: originalSummary,
      updated_at: '2026-04-05T12:00:00.000Z',
    })
  })
})
