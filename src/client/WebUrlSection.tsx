/**
 * The sharing settings section, laid out as system-style rows: allowed
 * hosts (checkboxes), the host used in the fixed address (dropdown menu), the
 * stable fixed address, and the current one-time tokenized address. Every
 * interaction is a one-shot RPC read or an RPC host-selection update; the
 * section holds no subscription state.
 *
 * @module dsh-share-webui/client/WebUrlSection
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { ShareWebuiPairing, ShareWebuiPortCheck, ShareWebuiResult } from '../wire.ts'
import type { ShareWebuiKey } from './locales.ts'
import css from './WebUrlSection.module.css'

/** Registration-side injected face: the RPCs this page needs. */
export interface WebUrlSectionInjected {
  /** Read the current fixed + tokenized addresses from the host. */
  readUrl: () => Promise<ShareWebuiResult>
  /** Change the host selection live and return the refreshed result. */
  updateHosts: (selection: readonly string[]) => Promise<ShareWebuiResult>
  /** Mint a pairing code (host machine only). */
  issuePairing: () => Promise<ShareWebuiPairing>
  /** Forget one paired device (host machine only). */
  revokeDevice: (id: string) => Promise<ShareWebuiResult>
  /** Probe whether a port can be bound (host machine only). */
  probePort: (port: string) => Promise<ShareWebuiPortCheck>
  /** Switch the fixed port and rebind (host machine only). */
  setPort: (port: string) => Promise<ShareWebuiResult>
  /** Drop the pending pairing code (host machine only). */
  clearPairing: () => Promise<ShareWebuiResult>
}

/** Full component props assembled by the settings-section renderer. */
export interface WebUrlSectionProps extends WebUrlSectionInjected {
  /** Close the settings panel (shell-owned affordance). */
  close: () => void
  /** Locale seat bound to this entry's dictionary namespace. */
  t: (key: ShareWebuiKey) => string
}

/** One-shot load outcome; `reload` bumps re-run the same load. */
type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly result: ShareWebuiResult }

/** Legacy copy fallback (Chromium keeps `execCommand` for user gestures). */
function legacyCopy(value: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    textarea.remove()
  }
  return copied
}

/**
 * Build the fixed URL for the host the user selected.
 * @param result - host result.
 * @param host - selected host, possibly empty.
 * @returns the URL to display and copy.
 */
function fixedUrlValue(result: ShareWebuiResult, host: string): string {
  if (host !== '' && typeof result.fixedUrl === 'string') {
    try {
      const url = new URL(result.fixedUrl)
      url.hostname = host
      return url.toString().replace(/\/$/, '')
    } catch {
      return result.fixedUrl
    }
  }
  return result.fixedUrl ?? ''
}

/**
 * Read-only address field with a copy button.
 * @param props - field props.
 * @returns the field control.
 */
function CopyField(props: {
  /** Address to display and copy. */
  value: string
  /** Placeholder shown when the address is unavailable. */
  placeholder: string
  /** Copy button label. */
  copy: string
  /** Copy button label after a successful copy. */
  copied: string
  /** Render the value larger (pairing codes). */
  big?: boolean
}): React.ReactElement {
  const { value, placeholder, copy, copied, big = false } = props
  const [flash, setFlash] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current)
  }, [])
  const copyValue = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      if (!legacyCopy(text)) {
        setFlash('failed')
        return
      }
    }
    setFlash('copied')
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => { setFlash('idle') }, 2_000)
  }
  return (
    <div className={css.valueGroup}>
      <div
        className={value === '' ? `${css.valueBox} ${css.valueEmpty}` : css.valueBox}
        title={value}
        style={big ? { fontSize: '18px', fontWeight: 600, letterSpacing: '.18em' } : undefined}
      >
        {value === '' ? placeholder : value}
      </div>
      <button type="button" className={css.action} onClick={() => { void copyValue(value) }}>
        {flash === 'copied' ? copied : copy}
      </button>
    </div>
  )
}

/** Setting row: title + description on the left, control on the right. */
function SettingRow(props: {
  /** Row title. */
  title: string
  /** Row description (omitted when empty). */
  description: string
  /** Control rendered on the right. */
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{props.title}</div>
        {props.description !== '' && <div className={css.desc}>{props.description}</div>}
      </div>
      <div className={css.control}>{props.children}</div>
    </div>
  )
}

/** Address block: title and description above, the value spanning the row. */
function AddressGroup(props: {
  /** Block title. */
  title: string
  /** Block description. */
  description: string
  /** Address row. */
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className={css.group}>
      <div className={css.title}>{props.title}</div>
      <div className={css.desc}>{props.description}</div>
      {props.children}
    </div>
  )
}

/** Render the section content. */
export function WebUrlSection({ readUrl, updateHosts, issuePairing, revokeDevice, probePort, setPort, clearPairing, t }: WebUrlSectionProps): React.ReactElement {
  const sectionId = useId()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [hostValue, setHostValue] = useState('')
  const [selection, setSelection] = useState<readonly string[]>(['loopback'])
  const [pendingOpen, setPendingOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pairing, setPairing] = useState<ShareWebuiPairing | null>(null)
  const [pairError, setPairError] = useState('')
  const [portText, setPortText] = useState('')
  const [portNote, setPortNote] = useState('')
  const [portBad, setPortBad] = useState(false)
  const [portBusy, setPortBusy] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)

  // Close the host menu on any pointer press outside it.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (hostRef.current !== null && !hostRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [menuOpen])

  // Fetch the addresses once per mount and per manual reload.
  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void Promise.resolve()
      .then(() => readUrl())
      .then(
        (result) => {
          if (!current) return
          setState({ status: 'ready', result })
          setHostValue(previous =>
            Array.isArray(result.hosts) && result.hosts.includes(previous) ? previous : result.hosts?.[0] ?? '')
          setSelection(Array.isArray(result.selection) && result.selection.length > 0 ? result.selection : ['loopback'])
          setPortText(typeof result.port === 'string' ? result.port : '')
        },
        (error: unknown) => {
          if (!current) return
          const message = error instanceof Error ? error.message : String(error)
          setState({ status: 'error', message })
        },
      )
    return () => {
      current = false
    }
  }, [readUrl, reload])

  // Pairing happens on another device while this page stays open, so the
  // device list has to refresh on its own: poll while visible, and again
  // whenever the window regains focus.
  useEffect(() => {
    const refresh = (): void => {
      if (document.visibilityState === 'hidden') return
      void Promise.resolve()
        .then(() => readUrl())
        .then(
          (result) => { setState({ status: 'ready', result }) },
          () => { /* keep the last good snapshot */ },
        )
    }
    const timer = setInterval(refresh, 5_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [readUrl])

  const retry = (): void => {
    setReload(value => value + 1)
  }

  const applySelection = (next: readonly string[]): void => {
    setBusy(true)
    void Promise.resolve()
      .then(() => updateHosts(next))
      .then(
        (result) => {
          setState({ status: 'ready', result })
          setSelection(Array.isArray(result.selection) ? result.selection : next)
          setHostValue(previous =>
            Array.isArray(result.hosts) && result.hosts.includes(previous) ? previous : result.hosts?.[0] ?? '')
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setState({ status: 'error', message })
        },
      )
      .finally(() => { setBusy(false) })
  }

  const toggleHost = (key: string, checked: boolean): void => {
    if (key === 'loopback') return
    const rest = selection.filter(item => item !== key && item !== 'loopback')
    const next = checked ? ['loopback', ...rest, key] : ['loopback', ...rest]
    if (key === 'any' && checked) {
      setPendingOpen(true)
      return
    }
    applySelection(next)
  }

  const hostCube = (
    key: string,
    labelKey: ShareWebuiKey,
    address: string,
    checked: boolean,
    locked: boolean,
  ): React.ReactElement => (
    <button
      key={key}
      type="button"
      className={checked ? `${css.cube} ${css.selected}` : css.cube}
      aria-pressed={checked}
      disabled={locked || busy}
      onClick={() => { toggleHost(key, !checked) }}
    >
      <span className={css.cubeAddr}>{address}</span>
      <span className={css.cubeName}>{t(labelKey)}</span>
    </button>
  )

  const hosts = state.status === 'ready' ? state.result.hosts ?? [] : []
  // Same wording as the host cubes: Chinese label plus the concrete address.
  const displayHost = (host: string): string => {
    if (host === '') return host
    const name = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u.test(host) || /\.ts\.net$/u.test(host)
      ? t('hostTailscale')
      : /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(host)
        ? t('hostLan')
        : host === '127.0.0.1' || host === 'localhost' || host === '::1'
          ? t('hostLoopback')
          : ''
    return name === '' ? host : `${name} (${host})`
  }
  // One button: probe first, then rebind on the new port. A port that cannot
  // be bound is reported in red instead of being applied.
  const applyPort = (): void => {
    setPortBusy(true)
    setPortNote('')
    setPortBad(false)
    void (async () => {
      try {
        const probe = await probePort(portText)
        if (probe.status !== 'free' && probe.status !== 'current') {
          setPortBad(true)
          setPortNote(probe.status === 'invalid' ? t('portInvalid') : t('portBusy'))
          return
        }
        const result = await setPort(portText)
        setState({ status: 'ready', result })
        setPortText(typeof result.port === 'string' ? result.port : portText)
        setPortNote(t('portFree'))
      } catch (error: unknown) {
        setPortBad(true)
        setPortNote(t('portFailed').replace('{{message}}', error instanceof Error ? error.message : String(error)))
      } finally {
        setPortBusy(false)
      }
    })()
  }

  const portRow = (
    <>
      <SettingRow title={t('portLabel')} description={t('portHint')}>
        <div className={css.valueGroup}>
          <input
            value={portText}
            aria-label={t('portLabel')}
            inputMode="numeric"
            onChange={(event) => { setPortText(event.target.value.replace(/\D/gu, '').slice(0, 5)) }}
            style={{
              boxSizing: 'border-box',
              width: '96px',
              height: '36px',
              padding: '0 12px',
              border: '.5px solid var(--dsw-alias-border-l2)',
              borderRadius: 'var(--dsw-radius-md, 8px)',
              background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              font: 'inherit',
              fontSize: '14px',
              lineHeight: '22px',
              textAlign: 'center',
            }}
          />
          <button type="button" className={css.action} disabled={portBusy} onClick={applyPort}>{t('portApply')}</button>
        </div>
      </SettingRow>
      {portNote !== '' && (
        <p
          className={portBad ? css.danger : css.desc}
          style={portBad
            ? { paddingBottom: '12px' }
            : { paddingBottom: '12px', color: 'var(--dsw-alias-state-success-primary, #16a34a)' }}
        >
          {portNote}
        </p>
      )}
    </>
  )

  // The host decides whether this page runs on the machine itself: the desktop
  // shell uses a custom scheme, so `location` cannot answer that question.
  const showPairing = state.status === 'ready' && state.result.local === 'host'

  const revoke = (id: string): void => {
    setPairError('')
    void Promise.resolve()
      .then(() => revokeDevice(id))
      .then(
        (result) => { setState({ status: 'ready', result }) },
        (error: unknown) => { setPairError(error instanceof Error ? error.message : String(error)) },
      )
  }

  const cancelPairing = (): void => {
    setPairError('')
    void (async () => {
      try {
        const result = await clearPairing()
        setState({ status: 'ready', result })
        setPairing(null)
      } catch (error: unknown) {
        setPairError(error instanceof Error ? error.message : String(error))
      }
    })()
  }

  const generatePairing = (): void => {
    setPairError('')
    void Promise.resolve()
      .then(() => issuePairing())
      .then(
        (issued) => { setPairing(issued) },
        (error: unknown) => {
          setPairing(null)
          setPairError(error instanceof Error ? error.message : String(error))
        },
      )
  }

  const confirmBox = !pendingOpen ? null : (
    <div className={css.errorBox}>
      <p className={css.danger}>{t('openConfirm')}</p>
      <button
        type="button"
        className={css.action}
        onClick={() => {
          setPendingOpen(false)
          applySelection(['loopback', ...selection.filter(item => item !== 'loopback' && item !== 'any'), 'any'])
        }}
      >
        {t('openConfirmYes')}
      </button>
      <button type="button" className={css.action} onClick={() => { setPendingOpen(false) }}>
        {t('cancel')}
      </button>
    </div>
  )

  return (
    <section className={css.section} aria-labelledby={sectionId}>
      <h2 className={css.heading} id={sectionId}>{t('title')}</h2>
      {state.status === 'loading' && (
        <p className={css.desc}>{t('loading')}</p>
      )}
      {state.status === 'error' && (
        <div className={css.errorBox}>
          <p className={css.desc}>{t('loadFailed').replace('{{message}}', state.message)}</p>
          <button type="button" className={css.action} onClick={retry}>{t('retry')}</button>
        </div>
      )}
      {state.status === 'ready' && (
        <div className={css.rows}>
          {state.result.local === 'host' && portRow}
          <div className={css.group}>
            <div className={css.title}>{t('hostsLabel')}</div>
            <div className={css.desc}>{t('hostsDesc')}</div>
            <div className={css.cubeRow}>
              {hostCube('loopback', 'hostLoopback', '127.0.0.1', true, true)}
              {hostCube('lan', 'hostLan', '192.168.x.x', selection.includes('lan'), false)}
              {hostCube('tailscale', 'hostTailscale', '100.x.x.x', selection.includes('tailscale'), false)}
              {hostCube('any', 'hostAny', '0.0.0.0', selection.includes('any'), false)}
            </div>
            {selection.includes('any') && <p className={css.danger}>{t('openWarning')}</p>}
            {confirmBox}
          </div>
          <SettingRow title={t('hostLabel')} description={t('hostHint')}>
            <div className={css.selectWrap} ref={hostRef}>
              <button
                type="button"
                className={css.selector}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => { setMenuOpen(value => !value) }}
              >
                {displayHost(hostValue !== '' ? hostValue : hosts[0] ?? '')}
                <svg
                  className={css.chevron}
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M4.5 6.25 8 9.75l3.5-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {menuOpen && (
                <div className={css.menu} role="menu">
                  {hosts.map(host => (
                    <button
                      key={host}
                      type="button"
                      role="menuitemradio"
                      aria-checked={host === hostValue}
                      className={host === hostValue ? `${css.option} ${css.optionSelected}` : css.option}
                      onClick={() => {
                        setHostValue(host)
                        setMenuOpen(false)
                      }}
                    >
                      <span>{displayHost(host)}</span>
                      {host === hostValue && <span className={css.checkMark}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </SettingRow>
          <AddressGroup title={t('fixedUrlLabel')} description={t('fixedUrlHint')}>
            <CopyField
              value={fixedUrlValue(state.result, hostValue)}
              placeholder={t('fixedUnavailable')}
              copy={t('copy')}
              copied={t('copied')}
            />
          </AddressGroup>
          <AddressGroup title={t('currentUrlLabel')} description={t('currentUrlHint')}>
            <CopyField
              value={state.result.url}
              placeholder=""
              copy={t('copy')}
              copied={t('copied')}
            />
          </AddressGroup>
          {showPairing && (
            <SettingRow title={t('accessTitle')} description={t('accessHint')}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className={css.action} onClick={generatePairing}>
                  {pairing === null ? t('accessOpen') : t('accessRegenerate')}
                </button>
                {pairing !== null && (
                  <button type="button" className={css.action} onClick={cancelPairing}>
                    {t('accessCancel')}
                  </button>
                )}
              </div>
            </SettingRow>
          )}
          {showPairing && pairing !== null && (
            <div className={css.group}>
              <div className={css.title}>{t('accessCodeLabel')}</div>
              <div className={css.desc}>
                {t('accessExpires').replace('{{time}}', new Date(pairing.expiresAt).toLocaleTimeString())}
              </div>
              <CopyField
                value={pairing.code}
                placeholder=""
                copy={t('copyCode')}
                copied={t('copiedCode')}
                big
              />
            </div>
          )}
          {showPairing && pairError !== '' && (
            <p className={css.danger}>{t('accessFailed').replace('{{message}}', pairError)}</p>
          )}
          {showPairing && state.status === 'ready' && (
            <div className={css.group}>
              <div className={css.title}>{t('accessDevices')}</div>
              <div className={css.desc}>{t('accessDevicesHint')}</div>
              {(state.result.devices ?? []).length === 0 && (
                <div className={css.desc}>{t('accessNone')}</div>
              )}
              {(state.result.devices ?? []).map(device => (
                <div key={device.id} className={css.row}>
                  <div className={css.rowText}>
                    <div className={css.title} title={device.label}>{device.label.slice(0, 48)}{device.label.length > 48 ? '…' : ''}</div>
                    <div className={css.desc}>
                      {t('accessMeta')
                        .replace('{{address}}', device.address)
                        .replace('{{time}}', new Date(device.pairedAt).toLocaleString())}
                    </div>
                  </div>
                  <div className={css.control}>
                    <button type="button" className={css.action} onClick={() => { revoke(device.id) }}>
                      {t('accessRevoke')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
