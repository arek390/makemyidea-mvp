import type { Engine2Finding } from './findingState'
import { toDirectPolishDisplayText } from './userFacingText'

export type Engine2FindingCardCopy = {
  confirmedStatus: string
  acceptAction: string
  editAction: string
  rejectAction: string
  saveAction: string
  cancelAction: string
  editInputAriaLabel: string
}

type Engine2FindingCardProps = {
  finding: Engine2Finding
  copy: Engine2FindingCardCopy
  isEditing: boolean
  editingContent: string
  disabled?: boolean
  onConfirm: (id: string) => void
  onReject: (id: string) => void
  onStartEdit: (id: string) => void
  onChangeEdit: (content: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}

export function Engine2FindingCard({
  finding,
  copy,
  isEditing,
  editingContent,
  disabled = false,
  onConfirm,
  onReject,
  onStartEdit,
  onChangeEdit,
  onSaveEdit,
  onCancelEdit,
}: Engine2FindingCardProps) {
  const canSave = editingContent.trim().length > 0
  const displayText = finding.displayText?.trim() || toDirectPolishDisplayText(finding.content)

  return (
    <article
      className={`engine2-finding-card engine2-finding-card--${finding.status}`}
      aria-label={finding.categoryLabel}
    >
      <div className="engine2-finding-card-meta">
        <span className="engine2-finding-card-category">{finding.categoryLabel}</span>
        {finding.status === 'confirmed' && (
          <span className="engine2-finding-card-status">{copy.confirmedStatus}</span>
        )}
      </div>

      {isEditing ? (
        <>
          <textarea
            className="engine2-finding-card-editor"
            value={editingContent}
            onChange={(event) => onChangeEdit(event.target.value)}
            aria-label={copy.editInputAriaLabel}
            rows={4}
            disabled={disabled}
          />
          <div className="engine2-finding-card-actions">
            <button
              className="engine2-finding-card-action engine2-finding-card-action--primary"
              type="button"
              onClick={onSaveEdit}
              disabled={!canSave || disabled}
              aria-label={copy.saveAction}
            >
              {copy.saveAction}
            </button>
            <button
              className="engine2-finding-card-action"
              type="button"
              onClick={onCancelEdit}
              disabled={disabled}
              aria-label={copy.cancelAction}
            >
              {copy.cancelAction}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="engine2-finding-card-content">{displayText}</p>
          <div className="engine2-finding-card-actions">
            {finding.status === 'pending' && (
              <button
                className="engine2-finding-card-action engine2-finding-card-action--primary"
                type="button"
                onClick={() => onConfirm(finding.id)}
                disabled={disabled}
                aria-label={copy.acceptAction}
              >
                {copy.acceptAction}
              </button>
            )}
            <button
              className="engine2-finding-card-action"
              type="button"
              onClick={() => onStartEdit(finding.id)}
              disabled={disabled}
              aria-label={copy.editAction}
            >
              {copy.editAction}
            </button>
            {finding.status === 'pending' && (
              <button
                className="engine2-finding-card-action"
                type="button"
                onClick={() => onReject(finding.id)}
                disabled={disabled}
                aria-label={copy.rejectAction}
              >
                {copy.rejectAction}
              </button>
            )}
          </div>
        </>
      )}
    </article>
  )
}
