import "@pierre/trees/web-components"
import { FileTree, type FileTreeDirectoryHandle, type FileTreeItemHandle } from "@pierre/trees"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { ChangeKind } from "../review/contract"
import { createKeyed, useExtension, type FileNode, type MountedSession, type SessionScreen } from "../sdk"
import { startFileDrag } from "./drag"
import { OpenInAppContextMenuV2, useOpenInApp } from "./open-in-app"
import { resolveOpenInAppPath } from "./path"
import {
  buildAllowedTreeInput,
  buildGitStatusMap,
  buildLiveTreeInput,
  diffGitStatusPatch,
  normalizeFileTreeV2Path,
  type AllowedTreeInput,
  type TreeGitStatus,
} from "./tree-model"

const TREE_UNSAFE_CSS = `
  :host {
    color-scheme: inherit;
    --trees-font-family: var(--font-family-sans); --trees-font-size: 12px;
    --trees-fg: var(--v2-text-text-muted); --trees-fg-muted: var(--v2-text-text-muted);
    --trees-bg: var(--v2-background-bg-base); --trees-bg-muted: var(--v2-overlay-simple-overlay-hover);
    --trees-border-color: color-mix(in srgb, var(--v2-border-border-muted) 50%, transparent);
    --trees-indent-guide-bg: color-mix(in srgb, var(--v2-border-border-muted) 50%, transparent);
    --trees-selected-bg: var(--v2-overlay-simple-overlay-pressed); --trees-selected-fg: var(--v2-text-text-base);
    --trees-selected-focused-border-color: transparent; --trees-focus-ring-color: transparent; --trees-focus-ring-width: 0px;
    --trees-git-modified-color: var(--v2-state-fg-info); --trees-git-renamed-color: var(--v2-state-fg-info);
    --trees-git-added-color: var(--v2-state-fg-success); --trees-git-untracked-color: var(--v2-state-fg-success);
    --trees-git-deleted-color: var(--v2-state-fg-danger); --trees-git-ignored-color: var(--v2-text-text-faint);
    --trees-padding-inline: 8px; --trees-item-margin-x: 0px;
  }
  [data-file-tree-virtualized-root="true"] { padding-top: 4px; }
  [data-file-tree-virtualized-scroll="true"] { padding: 0 8px; overflow-x: hidden; }
  button[data-type="item"] { box-shadow: none !important; cursor: inherit; font-weight: 500; }
  button[data-type="item"]:hover, button[data-type="item"][data-item-context-hover="true"] {
    background-color: var(--v2-overlay-simple-overlay-hover) !important;
  }
  button[data-type="item"][data-item-selected="true"], button[data-type="item"][data-item-selected="true"]:hover {
    color: var(--v2-text-text-base) !important; background-color: var(--v2-overlay-simple-overlay-pressed) !important;
  }
  button[data-type="item"]:focus-visible, button[data-type="item"][data-item-focused="true"] {
    outline: none !important; box-shadow: none !important;
  }
  button[data-type="item"]::before,
  [data-item-contains-git-change="true"]:not([data-item-git-status]) > [data-item-section="git"],
  [data-item-section="decoration"]:empty { display: none !important; }
  [data-type="item"]:not([data-item-selected="true"]) > [data-item-section="icon"] > * { color: var(--v2-icon-icon-muted) !important; }
  [data-item-git-status]:not([data-item-git-status="ignored"]) > [data-item-section="content"] { color: inherit; }
  [data-item-section="content"] {
    flex: 1 1 0; min-width: 0; overflow: clip; text-overflow: clip; white-space: nowrap;
    mask-image: linear-gradient(to right, #000 calc(100% - 16px), transparent);
  }
  :host(:dir(rtl)) [data-item-section="content"] { mask-image: linear-gradient(to left, #000 calc(100% - 16px), transparent); }
  [data-item-section="decoration"] { flex: 0 0 auto; color: var(--v2-text-text-weak, var(--v2-text-text-muted)); font-size: 12px; font-weight: 400; }
  [data-item-section="git"] {
    font-size: 11px; font-weight: 530; line-height: 1; letter-spacing: -0.04px;
    font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" on, "lnum" on;
  }
`

function isDirectoryHandle(handle: FileTreeItemHandle | null | undefined): handle is FileTreeDirectoryHandle {
  return Boolean(handle?.isDirectory())
}

function findTreeItemButton(event: Event) {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement && target.dataset.type === "item" && target.dataset.itemPath) return target
  }
}

function findFileButtonPath(event: Event) {
  const button = findTreeItemButton(event)

  return button?.dataset.itemType === "file" ? button.dataset.itemPath : undefined
}

export default function PierreFileTree(props: {
  session: MountedSession
  screen: SessionScreen
  active?: string
  allowed?: readonly string[]
  kinds?: ReadonlyMap<string, ChangeKind>
  labels?: ReadonlyMap<string, string>
  draggable?: boolean
  onFileClick?: (file: FileNode) => void
  onFileDoubleClick?: (file: FileNode) => void
}) {
  const ctx = useExtension()
  const file = props.screen.file
  const openIn = ctx.desktop ? useOpenInApp({ session: props.session, path: () => file.root }) : undefined
  const live = () => props.allowed === undefined
  const draggable = () => props.draggable ?? true
  const active = () => normalizeFileTreeV2Path(props.active ?? "")
  const expanded = (path: string) => file.tree.state(path)?.expanded ?? false
  const allowedModel = createMemo(() => (live() ? undefined : buildAllowedTreeInput(props.allowed ?? [])))

  const liveModel = createMemo(() =>
    live() ? buildLiveTreeInput((path) => file.tree.list(path), expanded) : undefined,
  )

  const [ready, setReady] = createSignal(false)
  const knownPaths = new Set<string>()
  const scrolled = { active: "" }
  let wrapper: HTMLDivElement | undefined
  let tree: FileTree | undefined
  let syncingSelection = false
  let syncingExpansion = false
  let appliedStatus = new Map<string, TreeGitStatus>()
  let renderedAllowed: AllowedTreeInput | undefined
  let renderedLabels = props.labels
  let renderedRoot = file.root

  const originalPath = (rawPath: string) => {
    const norm = normalizeFileTreeV2Path(rawPath)

    return (live() ? liveModel()?.nodesByPath.get(norm)?.path : allowedModel()?.originalByPath.get(norm)) ?? norm
  }

  const syncSelection = (target: string) => {
    if (!tree || syncingSelection) return
    const item = target ? tree.getItem(target) : null
    const resolved = item && !item.isDirectory() ? target : ""
    const current = tree.getSelectedPaths()

    if (resolved ? current.length === 1 && current[0] === resolved : current.length === 0) return
    syncingSelection = true

    for (const existing of current) {
      if (existing !== resolved) tree.getItem(existing)?.deselect()
    }

    if (resolved) tree.getItem(resolved)?.select()
    syncingSelection = false
  }

  const applyAllowedCollapsed = (model: AllowedTreeInput) => {
    if (!tree) return
    syncingExpansion = true

    for (const dir of model.directories) {
      const expand = model.untrackedDirs.has(dir)
        ? file.tree.state(dir)?.expanded === true
        : file.tree.state(dir)?.expanded !== false

      const handle = tree.getItem(dir)

      if (!expand && isDirectoryHandle(handle) && handle.isExpanded()) handle.collapse()
    }

    syncingExpansion = false
  }

  const toFileNode = (rawPath: string): FileNode => {
    const norm = normalizeFileTreeV2Path(rawPath)
    const existing = live() ? liveModel()?.nodesByPath.get(norm) : undefined

    if (existing) return existing
    const original = allowedModel()?.originalByPath.get(norm) ?? norm

    return { name: norm.split("/").at(-1) || norm, path: original, absolute: original, type: "file", ignored: false }
  }

  onMount(() => {
    if (!wrapper) return
    const isLive = live()
    const initialAllowed = allowedModel()
    const initialLive = liveModel()
    const initialPaths = isLive ? (initialLive?.paths ?? []) : (initialAllowed?.paths ?? [])
    const initialStatus = buildGitStatusMap(props.kinds, initialLive?.ignoredPaths)
    const initialGitStatus = Array.from(initialStatus, ([path, status]) => ({ path, status }))
    const initialActive = active()

    for (const item of initialPaths) knownPaths.add(item)
    appliedStatus = initialStatus
    renderedAllowed = initialAllowed
    renderedLabels = props.labels
    renderedRoot = file.root

    tree = new FileTree({
      paths: initialPaths,
      flattenEmptyDirectories: false,
      initialExpansion: isLive ? "closed" : "open",
      initialExpandedPaths: isLive ? initialLive?.expandedDirs : undefined,
      initialSelectedPaths: initialActive ? [initialActive] : undefined,
      sort: isLive
        ? (a, b) => {
            const map = liveModel()?.orderByPath

            return (
              (map?.get(normalizeFileTreeV2Path(a.path)) ?? 0) -
              (map?.get(normalizeFileTreeV2Path(b.path)) ?? 0)
            )
          }
        : "default",
      icons: "complete",
      itemHeight: 28,
      stickyFolders: false,
      gitStatus: initialGitStatus.length > 0 ? initialGitStatus : undefined,
      dragAndDrop: draggable() ? { canDrag: () => true, canDrop: () => false } : false,
      unsafeCSS: TREE_UNSAFE_CSS,
      renderRowDecoration: ({ row }) => {
        if (row.kind !== "directory") return null
        const label = props.labels?.get(normalizeFileTreeV2Path(row.path))

        return label ? { text: label } : null
      },
      onExpansionChange(change) {
        if (syncingExpansion) return
        const original = originalPath(change.path)

        if (change.expanded) file.tree.expand(original, live() ? undefined : { list: false })
        else file.tree.collapse(original)
      },
      onSelectionChange: () => syncSelection(active()),
    })

    if (!isLive && initialAllowed) applyAllowedCollapsed(initialAllowed)
    tree.render({ containerWrapper: wrapper })
    tree.getFileTreeContainer()?.classList.add("opencode-pierre-file-tree")
    setReady(true)
    onCleanup(() => {
      tree?.cleanUp()
      tree = undefined
    })
  })

  // The live tree lists the root whenever it is not loaded, e.g. again after the workspace's tree resets.
  createKeyed(
    () => {
      if (!live()) return
      const root = file.tree.state("")

      return root?.loaded ? undefined : { root }
    },
    () => void file.tree.sync(""),
  )

  // Replaces the tree paths when `allowed` or `labels` changes after mount.
  createKeyed(
    () => (ready() && !live() ? { model: allowedModel()!, labels: props.labels } : undefined),
    ({ model, labels }) => {
      if (!tree || (model === renderedAllowed && labels === renderedLabels)) return
      renderedAllowed = model
      renderedLabels = labels
      knownPaths.clear()

      for (const item of model.paths) knownPaths.add(item)
      syncSelection("")
      tree.resetPaths(model.paths)
      applyAllowedCollapsed(model)
      syncSelection(active())
    },
  )

  // Incrementally batches newly loaded or unlinked directory entries into the live tree.
  createKeyed(
    () => (ready() && live() ? { root: file.root, model: liveModel()! } : undefined),
    (current) => {
      if (!tree) return

      if (current.root !== renderedRoot) {
        renderedRoot = current.root
        knownPaths.clear()
        tree.resetPaths([])
      }

      const nextSet = new Set(current.model.paths)
      const expandedSet = new Set(current.model.expandedDirs)
      const ops: Array<{ type: "add"; path: string } | { type: "remove"; path: string; recursive: boolean }> = []

      for (const existing of knownPaths) {
        if (nextSet.has(existing)) continue
        const trimmed = existing.endsWith("/") ? existing.slice(0, -1) : existing
        const slash = trimmed.lastIndexOf("/")
        const parent = slash === -1 ? "" : `${trimmed.slice(0, slash + 1)}`

        if (parent === "" || expandedSet.has(parent)) {
          ops.push({ type: "remove", path: existing, recursive: existing.endsWith("/") })
          knownPaths.delete(existing)
        }
      }

      for (const item of current.model.paths) {
        if (knownPaths.has(item)) continue
        knownPaths.add(item)
        ops.push({ type: "add", path: item })
      }

      if (ops.length > 0) tree.batch(ops)
      syncingExpansion = true

      for (const dir of current.model.expandedDirs) {
        const handle = tree.getItem(dir)

        if (isDirectoryHandle(handle) && !handle.isExpanded()) handle.expand()
      }

      syncingExpansion = false
      syncSelection(active())
    },
  )

  // Incrementally patches git status badges and ignored entries via `applyGitStatusPatch`.
  createKeyed(
    () => (ready() ? { kinds: props.kinds, ignored: liveModel()?.ignoredPaths } : undefined),
    (current) => {
      if (!tree) return
      const next = buildGitStatusMap(current.kinds, current.ignored)
      const patch = diffGitStatusPatch(appliedStatus, next)
      appliedStatus = next

      if (patch.remove.length > 0 || patch.set.length > 0) tree.applyGitStatusPatch(patch)
    },
  )

  // Only scroll when the active path changes (or first appears in the tree) and is outside the viewport.
  createKeyed(
    () => {
      if (!ready()) return { path: "", present: false }
      const path = active()
      void allowedModel()
      void liveModel()
      const item = path ? tree?.getItem(path) : null

      return { path, present: Boolean(item && !item.isDirectory()) }
    },
    (current) => {
      syncSelection(current.path)

      if (!current.path) {
        scrolled.active = ""

        return
      }

      if (!current.present || scrolled.active === current.path) return
      scrolled.active = current.path
      queueMicrotask(() => {
        if (!tree) return

        const scroller = tree
          .getFileTreeContainer()
          ?.shadowRoot?.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll]")

        const scrollTop = scroller?.scrollTop ?? 0
        const viewportHeight = scroller?.clientHeight || 600
        const startIndex = Math.floor(scrollTop / 28)
        const endIndex = Math.max(startIndex, Math.floor((scrollTop + viewportHeight - 1) / 28))

        if (tree.getVisibleRows(startIndex, endIndex).some((row) => row.path === current.path)) return
        tree.scrollToPath(current.path, { focus: false, offset: "nearest" })
      })
    },
    { equals: (previous, next) => previous.path === next.path && previous.present === next.present },
  )

  const resolveContextPath = (event: MouseEvent) => {
    const rawPath = findFileButtonPath(event)

    if (!rawPath) return
    const node = toFileNode(rawPath)

    return resolveOpenInAppPath(file.root, node.absolute || node.path)
  }

  return (
    <OpenInAppContextMenuV2 state={openIn} resolvePath={resolveContextPath}>
      <div
        ref={wrapper}
        data-component="file-tree-v2"
        data-total-rows={live() ? (liveModel()?.paths.length ?? 0) : (allowedModel()?.total ?? 0)}
        class="group/file-tree-v2"
        onClick={(event) => {
          const path = findFileButtonPath(event)

          if (path) props.onFileClick?.(toFileNode(path))
        }}
        onDblClick={(event) => {
          const path = findFileButtonPath(event)

          if (path) props.onFileDoubleClick?.(toFileNode(path))
        }}
        onDragStart={(event) => {
          if (!draggable()) return
          const button = findTreeItemButton(event)

          if (button?.dataset.itemPath) startFileDrag(event, originalPath(button.dataset.itemPath))
        }}
      />
    </OpenInAppContextMenuV2>
  )
}
