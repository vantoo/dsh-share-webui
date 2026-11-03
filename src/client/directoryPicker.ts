/**
 * In-page directory picker. Built from plain DOM instead of React because it
 * replaces a service call (`uiWorkspace.pickDirectory`) that the workspace
 * flow invokes outside our own component tree.
 *
 * @module dsh-share-webui/client/directoryPicker
 */

/** One directory level as returned by the host browse API. */
interface DirectoryEntry {
  readonly name: string
  readonly path: string
  readonly hidden: boolean
}

/** One listing as returned by the host browse API. */
interface DirectoryListing {
  readonly path: string
  readonly home: string
  readonly crumbs: DirectoryEntry[]
  readonly entries: DirectoryEntry[]
  readonly truncated: boolean
}

/** The subset of the workspace service the picker drives. */
export interface PickerWorkspace {
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  createDirectory: (path: string, name: string) => Promise<string>
}

/** Locale-bound copy. */
export type Translate = (key: string) => string

const STYLE_ID = 'dsh-share-webui-picker-style'

/** Token-driven styles, matching the shipped dialogs. */
const CSS = `
.dswp-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.45))}
.dswp-panel{box-sizing:border-box;display:flex;flex-direction:column;width:560px;max-width:100%;max-height:min(72vh,640px);overflow:hidden;border-radius:var(--dsw-radius-panel,16px);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);box-shadow:0 24px 64px rgba(0,0,0,.36);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dswp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:16px 20px 12px}
.dswp-title{margin:0;font-size:16px;line-height:24px;font-weight:600}
.dswp-icon{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;cursor:pointer}
.dswp-crumbs{display:flex;align-items:center;gap:8px;padding:0 20px 12px;min-width:0}
.dswp-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 10px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px}
.dswp-list{flex:1;min-height:160px;overflow-y:auto;padding:6px 8px;border-top:.5px solid var(--dsw-alias-border-l2);border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dswp-row{display:flex;align-items:center;gap:10px;width:100%;min-height:38px;padding:0 12px;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.dswp-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dswp-row span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dswp-foot{display:flex;align-items:center;gap:8px;padding:12px 20px 16px}
.dswp-create{display:flex;align-items:center;gap:8px;padding:12px 20px 0}
.dswp-btn{height:36px;padding:0 16px;border:none;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.dswp-btn:disabled{opacity:.5;cursor:default}
.dswp-btn-sm{height:30px;padding:0 10px;font-size:13px}
.dswp-primary{height:36px;padding:0 16px;border:none;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);font:inherit;cursor:pointer}
.dswp-primary:disabled{opacity:.5;cursor:default}
.dswp-input{flex:1;min-width:0;height:36px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
.dswp-spacer{flex:1}
.dswp-meta{margin:0;padding:12px 20px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dswp-error{margin:0;padding:12px 20px;color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}
`

/** Create one element with an optional class and text. */
function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Install the shared stylesheet once. */
function ensureStyle(): void {
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) !== null) return
  const style = document.createElement('style')
  style.setAttribute('data-plugin-css', STYLE_ID)
  style.textContent = CSS
  document.head.appendChild(style)
}

/**
 * Open the picker and resolve with the chosen directory.
 * @param workspace - the client workspace service.
 * @param t - locale-bound copy.
 * @returns the picked absolute path, or null when dismissed.
 */
export function openDirectoryPicker(workspace: PickerWorkspace, t: Translate): Promise<string | null> {
  return new Promise((resolve) => {
    ensureStyle()
    const backdrop = make('div', 'dswp-backdrop')
    const panel = make('div', 'dswp-panel')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')

    const head = make('div', 'dswp-head')
    head.append(make('h2', 'dswp-title', t('pickerTitle')))
    const close = make('button', 'dswp-icon', '×')
    close.type = 'button'
    close.setAttribute('aria-label', t('pickerCancel'))
    head.append(close)

    const crumbs = make('div', 'dswp-crumbs')
    const up = make('button', 'dswp-btn dswp-btn-sm', '↑')
    up.type = 'button'
    const path = make('div', 'dswp-path')
    crumbs.append(up, path)

    const list = make('div', 'dswp-list')

    const createRow = make('div', 'dswp-create')
    createRow.hidden = true
    const nameInput = make('input', 'dswp-input')
    nameInput.placeholder = t('pickerFolderName')
    const createButton = make('button', 'dswp-primary', t('pickerCreate'))
    createButton.type = 'button'
    const createCancel = make('button', 'dswp-btn', t('pickerCancel'))
    createCancel.type = 'button'
    createRow.append(nameInput, createButton, createCancel)

    const foot = make('div', 'dswp-foot')
    const newFolder = make('button', 'dswp-btn', t('pickerNewFolder'))
    newFolder.type = 'button'
    const cancel = make('button', 'dswp-btn', t('pickerCancel'))
    cancel.type = 'button'
    const pick = make('button', 'dswp-primary', t('pickerPick'))
    pick.type = 'button'
    foot.append(newFolder, make('span', 'dswp-spacer'), cancel, pick)

    panel.append(head, crumbs, list, createRow, foot)
    backdrop.append(panel)
    document.body.append(backdrop)

    let current = ''
    let home = ''
    let ticket = 0

    const finish = (value: string | null): void => {
      document.removeEventListener('keydown', onKey)
      backdrop.remove()
      resolve(value)
    }

    const failure = (error: unknown): void => {
      list.replaceChildren(make('p', 'dswp-error', error instanceof Error ? error.message : String(error)))
    }

    const load = async (target?: string): Promise<void> => {
      const mine = ++ticket
      list.replaceChildren(make('p', 'dswp-meta', t('pickerLoading')))
      try {
        const listing = await workspace.listDirectory(target)
        if (mine !== ticket) return
        current = listing.path
        home = listing.home
        path.textContent = current === '' ? t('pickerHome') : current
        path.title = current
        up.disabled = current === '' || current === home
        pick.disabled = current === ''
        newFolder.disabled = current === ''
        const rows: HTMLElement[] = listing.entries.map((entry) => {
          const row = make('button', 'dswp-row')
          row.type = 'button'
          row.append(make('span', undefined, '📁'), make('span', undefined, entry.name))
          row.addEventListener('click', () => { void load(entry.path) })
          return row
        })
        if (rows.length === 0) rows.push(make('p', 'dswp-meta', t('pickerEmpty')))
        if (listing.truncated === true) rows.push(make('p', 'dswp-meta', t('pickerTruncated')))
        list.replaceChildren(...rows)
      } catch (error: unknown) {
        if (mine === ticket) failure(error)
      }
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(null)
    }
    document.addEventListener('keydown', onKey)

    up.addEventListener('click', () => { void load(current.replace(/\/[^/]+$/u, '') || '/') })
    close.addEventListener('click', () => { finish(null) })
    cancel.addEventListener('click', () => { finish(null) })
    pick.addEventListener('click', () => { if (current !== '') finish(current) })
    backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) finish(null) })
    newFolder.addEventListener('click', () => {
      createRow.hidden = false
      nameInput.value = ''
      nameInput.focus()
    })
    createCancel.addEventListener('click', () => { createRow.hidden = true })
    createButton.addEventListener('click', () => {
      const name = nameInput.value.trim()
      if (name === '' || current === '') return
      void (async () => {
        try {
          const created = await workspace.createDirectory(current, name)
          createRow.hidden = true
          await load(created)
        } catch (error: unknown) {
          failure(error)
        }
      })()
    })

    void load()
  })
}
