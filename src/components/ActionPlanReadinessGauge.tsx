import { useMemo } from 'react'

type GaugeLevel = 'not_ready' | 'can_proceed' | 'strong_material'

export function ActionPlanReadinessGauge(props: {
  score: number
  level: GaugeLevel
  language: 'pl' | 'en'
}) {
  const { level, language } = props

  const labels = useMemo(() => {
    if (language === 'pl') {
      return ['Za wcześnie', 'Możesz przejść', 'Dobry moment'] as const
    }
    return ['Too early', 'You can proceed', 'Good moment'] as const
  }, [language])

  const needleAngle = useMemo(() => {
    // Three discrete positions only (no continuous mapping).
    // Semi-gauge spans roughly from -150deg (left) to -30deg (right).
    if (level === 'not_ready') return -150
    if (level === 'strong_material') return -30
    return -90
  }, [level])

  const activeIndex = level === 'not_ready' ? 0 : level === 'can_proceed' ? 1 : 2

  // SVG helpers (centered semi gauge)
  const width = 240
  const height = 140
  const viewBoxTopPad = 22
  const cx = width / 2
  const cy = 120
  const r = 88
  const stroke = 16
  // Keep the needle tip clearly inside the arc (avoid visually "cutting" the colored stroke).
  const needleLen = Math.max(10, r - stroke / 2 - 10)

  const needleEnd = useMemo(() => {
    // Compute endpoint directly (avoid SVG/CSS transform quirks).
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const rad = toRad(needleAngle)
    return {
      x: cx + needleLen * Math.cos(rad),
      y: cy + needleLen * Math.sin(rad),
    }
  }, [cx, cy, needleAngle, needleLen])

  const arcAtRadius = (radius: number, startDeg: number, endDeg: number) => {
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const start = toRad(startDeg)
    const end = toRad(endDeg)
    const x1 = cx + radius * Math.cos(start)
    const y1 = cy + radius * Math.sin(start)
    const x2 = cx + radius * Math.cos(end)
    const y2 = cy + radius * Math.sin(end)
    const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
    const sweep = 1
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${x2.toFixed(
      2
    )} ${y2.toFixed(2)}`
  }

  // Use tiny gaps between segments to keep hard boundaries (no blending / overlap).
  // With `strokeLinecap="round"` the caps extend beyond the arc endpoints; the gap must be
  // large enough to prevent visual overlap between adjacent segments.
  const gapDeg = 14
  const segs = [
    {
      key: 'low',
      d: arcAtRadius(r, -180, -120 - gapDeg / 2),
      color: '#64748B',
      labelPath: arcAtRadius(r + stroke / 2 + 8, -176, -124),
    },
    {
      key: 'med',
      d: arcAtRadius(r, -120 + gapDeg / 2, -60 - gapDeg / 2),
      color: '#2563EB',
      labelPath: arcAtRadius(r + stroke / 2 + 8, -116, -64),
    },
    {
      key: 'high',
      d: arcAtRadius(r, -60 + gapDeg / 2, 0),
      color: '#7C3AED',
      labelPath: arcAtRadius(r + stroke / 2 + 8, -56, -4),
    },
  ] as const

  const segmentOpacity = (idx: number) => (idx === activeIndex ? 1 : 0.22)

  return (
    <div className="action-plan-readiness-gauge" aria-label="Action plan readiness gauge">
      <svg
        className="action-plan-readiness-gauge__svg"
        viewBox={`0 ${-viewBoxTopPad} ${width} ${height + viewBoxTopPad}`}
        role="img"
        aria-hidden="true"
      >
        <defs>
          {segs.map((seg) => (
            <path
              key={`path-${seg.key}`}
              id={`aprgLabelPath-${seg.key}`}
              d={seg.labelPath}
              fill="none"
              stroke="transparent"
              strokeWidth="1"
            />
          ))}
        </defs>

        {segs.map((seg, idx) => {
          const isActive = idx === activeIndex
          return (
            <text
              key={`label-${seg.key}`}
              className={
                isActive
                  ? 'action-plan-readiness-gauge__arc-label is-active'
                  : 'action-plan-readiness-gauge__arc-label'
              }
            >
              <textPath href={`#aprgLabelPath-${seg.key}`} startOffset="50%" textAnchor="middle">
                {labels[idx]}
              </textPath>
            </text>
          )
        })}

        {segs.map((seg, idx) => {
          const isActive = idx === activeIndex
          return (
            <g key={seg.key} className="action-plan-readiness-gauge__segment-group">
              {isActive && (
                <path
                  d={seg.d}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={stroke + 10}
                  strokeLinecap="round"
                  opacity={0.22}
                />
              )}
              <path
                d={seg.d}
                fill="none"
                stroke={seg.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                className={
                  isActive
                    ? 'action-plan-readiness-gauge__segment is-active'
                    : 'action-plan-readiness-gauge__segment'
                }
                opacity={segmentOpacity(idx)}
              />
            </g>
          )
        })}

        <line
          className="action-plan-readiness-gauge__needle"
          x1={cx}
          y1={cy}
          x2={needleEnd.x}
          y2={needleEnd.y}
          stroke="#111827"
          strokeWidth="3"
        />
        <circle cx={cx} cy={cy} r="5.5" fill="#111827" />
      </svg>
    </div>
  )
}
