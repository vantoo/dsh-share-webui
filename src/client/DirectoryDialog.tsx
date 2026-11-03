import React, { useCallback, useEffect, useRef, useState } from 'react'

/** One directory level as returned by the host browse API. */
export interface DirectoryEntry {
  readonly name: string
  readonly path: string
  readonly hidden: boolean
}

/** One directory listing as returned by the host browse API. */
export interface DirectoryListing {
  readonly path: string
  readonly home: string
  readonly crumbs: DirectoryEntry[]
  readonly entries: DirectoryEntry[]
  readonly truncated: boolean
}

/** Copy the dialog needs, already bound to the active locale. */
export type Translate = (key: string) => string

/** Props forwarded by the directory-flow slot that owns this dialog. */
export interface DirectoryFlowProps {
  /** Whether the flow is asking for a directory right now. */
  readonly open: boolean
  /** Whether the owner is busy with a previous pick. */
  readonly busy?: boolean
  /** Report the chosen absolute path. */
  readonly onPicked: (path: string) => void
  /** Report that the user dismissed the flow. */
  readonly onCancel: () => void
  /** List one host directory level. */
  readonly listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  /** Create one child directory and return its absolute path. */
  readonly createDirectory: (path: string, name: string) => Promise<string>
  /** Locale-bound copy. */
  readonly t: Translate
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--dsw-alias-bg-overlay, rgba(0,0,0,.45))',
  padding: '24px',
}

const panel: React.CSSProperties = {
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  width: '560px',
  maxWidth: '100%',
  maxHeight: 'min(72vh, 640px)',
  borderRadius: 'var(--dsw-radius-panel, 16px)',
  background: 'var(--dsw-alias-bg-layer-2)',
  border: '.5px solid var(--dsw-alias-border-l2)',
  boxShadow: '0 24px 64px rgba(0,0,0,.36)',
  color: 'var(--dsw-alias-label-primary)',
  overflow: 'hidden',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '16px 20px 12px',
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '16px',
  lineHeight: '24px',
  fontWeight: 600,
}

const iconButton: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary)',
  cursor: 'pointer',
  width: '28px',
  height: '28px',
  borderRadius: 'var(--dsw-radius-md, 8px)',
  fontSize: '16px',
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const crumbBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '0 20px 12px',
  minWidth: 0,
}

const pathBox: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '12px',
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-secondary)',
  padding: '6px 10px',
  borderRadius: 'var(--dsw-radius-md, 8px)',
  background: 'var(--dsw-alias-bg-layer-1)',
  border: '.5px solid var(--dsw-alias-border-l2)',
}

const listStyle: React.CSSProperties = {
  flex: 1,
  minHeight: '160px',
  overflowY: 'auto',
  borderTop: '.5px solid var(--dsw-alias-border-l2)',
  borderBottom: '.5px solid var(--dsw-alias-border-l2)',
  padding: '6px 8px',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: '100%',
  minHeight: '38px',
  padding: '0 12px',
  border: 'none',
  borderRadius: 'var(--dsw-radius-md, 8px)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: '14px',
  lineHeight: '22px',
  textAlign: 'left',
  cursor: 'pointer',
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 20px 16px',
}

const buttonStyle: React.CSSProperties = {
  height: '36px',
  padding: '0 16px',
  border: 'none',
  borderRadius: 'var(--dsw-radius-md, 8px)',
  font: 'inherit',
  fontSize: '14px',
  cursor: 'pointer',
  background: 'var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1))',
  color: 'var(--dsw-alias-label-primary)',
}

const primaryStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--dsw-alias-brand-primary)',
  color: 'var(--dsw-alias-label-primary-foreground, #fff)',
}

const metaStyle: React.CSSProperties = {
  margin: 0,
  padding: '12px 20px',
  fontSize: '13px',
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-tertiary)',
}

const errorStyle: React.CSSProperties = {
  ...metaStyle,
  color: 'var(--dsw-alias-state-error-primary)',
}

/**
 * Web directory browser used when the page is opened from another machine: the
 * shipped flow opens a picker on the host display, which a remote browser can
 * never see.
 * @param props - owner props plus the injected browse face.
 * @returns the dialog element (renders nothing while closed).
 */
export function DirectoryDialog(props: DirectoryFlowProps): React.ReactElement | null {
  const { open, busy, onPicked, onCancel, listDirectory, createDirectory, t } = props
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [folderName, setFolderName] = useState('')
  const requestRef = useRef(0)

  const load = useCallback((path?: string) => {
    const ticket = requestRef.current + 1
    requestRef.current = ticket
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const next = await listDirectory(path)
        if (requestRef.current === ticket) setListing(next)
      } catch (cause: unknown) {
        if (requestRef.current === ticket) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (requestRef.current === ticket) setLoading(false)
      }
    })()
  }, [listDirectory])

  useEffect(() => {
    if (!open) return
    setCreating(false)
    setFolderName('')
    load()
  }, [open, load])

  if (!open) return null

  const current = listing?.path ?? ''
  const parent = current === '' ? '' : current.replace(/\/[^/]+$/u, '') || '/'

  return (
    <div style={backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div style={panel} role="dialog" aria-modal="true">
        <div style={headerStyle}>
          <h2 style={titleStyle}>{t('pickerTitle')}</h2>
          <button type="button" style={iconButton} aria-label={t('pickerCancel')} onClick={onCancel}>×</button>
        </div>
        <div style={crumbBar}>
          <button
            type="button"
            style={{ ...buttonStyle, height: '30px', padding: '0 10px', fontSize: '13px' }}
            disabled={current === '' || current === listing?.home}
            onClick={() => { load(parent) }}
          >↑</button>
          <div style={pathBox} title={current}>{current === '' ? t('pickerHome') : current}</div>
        </div>
        <div style={listStyle}>
          {loading && <p style={metaStyle}>{t('pickerLoading')}</p>}
          {!loading && error !== '' && <p style={errorStyle}>{error}</p>}
          {!loading && error === '' && (listing?.entries.length ?? 0) === 0 && <p style={metaStyle}>{t('pickerEmpty')}</p>}
          {!loading && error === '' && (listing?.entries ?? []).map((entry) => (
            <button
              key={entry.path}
              type="button"
              style={rowStyle}
              onClick={() => { load(entry.path) }}
              onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)' }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
            >
              <span aria-hidden="true">📁</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
            </button>
          ))}
          {listing?.truncated === true && <p style={metaStyle}>{t('pickerTruncated')}</p>}
        </div>
        {creating && (
          <div style={{ ...footerStyle, paddingBottom: 0 }}>
            <input
              autoFocus
              value={folderName}
              placeholder={t('pickerFolderName')}
              onChange={(event) => { setFolderName(event.target.value) }}
              style={{ ...pathBox, flex: 1, fontFamily: 'inherit', fontSize: '14px' }}
            />
            <button
              type="button"
              style={primaryStyle}
              disabled={folderName.trim() === '' || current === ''}
              onClick={() => {
                const name = folderName.trim()
                if (name === '' || current === '') return
                void (async () => {
                  try {
                    const created = await createDirectory(current, name)
                    setCreating(false)
                    setFolderName('')
                    load(created)
                  } catch (cause: unknown) {
                    setError(cause instanceof Error ? cause.message : String(cause))
                  }
                })()
              }}
            >{t('pickerCreate')}</button>
            <button type="button" style={buttonStyle} onClick={() => { setCreating(false); setFolderName('') }}>
              {t('pickerCancel')}
            </button>
          </div>
        )}
        <div style={footerStyle}>
          <button
            type="button"
            style={buttonStyle}
            disabled={current === ''}
            onClick={() => { setCreating(true) }}
          >{t('pickerNewFolder')}</button>
          <span style={{ flex: 1 }} />
          <button type="button" style={buttonStyle} onClick={onCancel}>{t('pickerCancel')}</button>
          <button
            type="button"
            style={primaryStyle}
            disabled={current === '' || busy === true}
            onClick={() => { onPicked(current) }}
          >{t('pickerPick')}</button>
        </div>
      </div>
    </div>
  )
}
