import type { SessionInfo } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { motionTuning } from "@opencode/ui/motion-tuning"
import {
  displayName,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { useNavigate } from "@solidjs/router"
import { createMemo, createSignal, For, Show, type ComponentProps, type JSX, type ParentProps } from "solid-js"
import { containsDirectory, getFilename } from "@opencode/util/path"
import { useServer } from "@/runtime/server/current"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { ServerLabel } from "@/servers/registry/label"
import { fileManagerApp } from "@/home/projects/file-manager"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { errorMessage } from "@/shell/layout/helpers"
import { useLayout, type LocalProject } from "@/shell/state/layout"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import { useSettingsSurface } from "@/settings/surface"
import { pathKey } from "@/workspaces/path-key"
import { isProjectDirectory, workspaceDirectories } from "@/workspaces/paths"
import { sessionHref } from "@/shell/routes/session"
import { showToast } from "@/shell/notifications/toast"
import { sessionTitle } from "./title"
import { SessionWorkingIndicator } from "./header/session-working-indicator"
import { CollapsedSidebarToggleSpace } from "@/shell/sidebar-toggle"
import "./session-identity-header.css"

const separatorChoice = motionTuning.choice("sessionHeader.separator", {
  label: "Session header separator",
  group: "Experiments",
  value: "slash",
  labels: {
    slash: "Slash",
    chevron: "Chevron",
    caret: "Mini caret",
    dot: "Middle dot",
    chip: "Project chip",
    divider: "Divider",
  },
})

const [separator, setSeparator] = createSignal(separatorChoice())

motionTuning.subscribe(() => setSeparator(separatorChoice()))

export function SessionTitleHeader(props: ParentProps) {
  return (
    <>
      {/* The bottom inset reserves room for the fade without covering rows stuck below the bar. */}
      <div data-session-title class="pointer-events-none sticky top-0 z-30 w-full pb-4">
        <div class="pointer-events-auto flex items-center bg-v2-background-bg-base pe-3 ps-2.5">
          <CollapsedSidebarToggleSpace />
          <div class="min-w-0 flex-1">{props.children}</div>
        </div>
      </div>
      {/* Stuck timeline headers stack above this fade, so it only fades content scrolling under the bar. */}
      <div
        aria-hidden="true"
        class="session-header-fade pointer-events-none sticky z-[5] -mt-4 h-4 w-full bg-[linear-gradient(to_bottom,var(--v2-background-bg-base),transparent)]"
      />
    </>
  )
}

export function SessionHeaderLayout(props: ParentProps<{ location: JSX.Element; actions?: JSX.Element }>) {
  return (
    <div class="session-header-layout">
      <div class="session-header-location">{props.location}</div>
      <div class="session-header-title">{props.children}</div>
      <Show when={props.actions}>
        <div class="session-header-actions">{props.actions}</div>
      </Show>
    </div>
  )
}

/**
 * Where the session runs: the project and its worktree. Opens a card with the server, the full path and the location's
 * actions.
 */
export function SessionLocation(props: {
  project?: Omit<LocalProject, "expanded">
  directory?: string
  /** Child sessions show only the project; their lineage follows. */
  compact?: boolean
  /** Adds the separator before the title or lineage that follows. */
  trailing?: boolean
}) {
  const server = useServer()
  const servers = useServers()
  const language = useLanguage()
  const platform = usePlatform()
  const layout = useLayout()
  const settingsSurface = useSettingsSurface()
  const navigate = useNavigate()

  const projectName = createMemo(() => displayName(props.project ?? { worktree: props.directory ?? "" }))

  const worktree = createMemo(() => {
    const directory = props.directory

    if (!props.project || !directory) return
    const root = workspaceDirectories(props.project).find((item) => containsDirectory(item, directory))

    return root ? getFilename(root) : undefined
  })

  const git = () => !!props.project?.vcs

  const branch = () =>
    props.directory ? server.ctx.data.location.vcs.info({ directory: props.directory })?.branch.current : undefined

  const baseBranch = () =>
    props.project ? server.ctx.data.location.vcs.info({ directory: props.project.worktree })?.branch.current : undefined

  // Revealing a path only makes sense on the machine the app runs on.
  const canReveal = () =>
    platform.platform === "desktop" && !!platform.revealPath && servers.current(server.conn) && !!props.directory

  const onOpenChange = (open: boolean) => {
    if (!open || !props.directory || !git()) return
    void server.ctx.data.location.vcs.sync({ directory: props.directory }).catch(() => undefined)

    if (props.project && props.project.worktree !== props.directory)
      void server.ctx.data.location.vcs.sync({ directory: props.project.worktree }).catch(() => undefined)
  }

  const copyPath = async () => {
    const directory = props.directory

    if (!directory) return

    try {
      await (platform.writeClipboardText?.(directory) ?? navigator.clipboard.writeText(directory))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("common.copied"),
        description: directory,
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: errorMessage(cause, language.t("common.requestFailed")),
      })
    }
  }

  const reveal = () => {
    const directory = props.directory

    if (!canReveal() || !platform.revealPath || !directory) return
    void platform.revealPath(directory).catch((cause: unknown) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(cause, language.t("common.requestFailed")),
      }),
    )
  }

  const openProject = () => {
    const project = props.project

    if (!project) return
    server.ctx.projects.touch(project.worktree)
    layout.home.setSelection({ server: server.key, directory: project.worktree })
    navigate("/")
  }

  const openProjectSettings = () => {
    const project = props.project

    if (!project) return
    settingsSurface.openProject({ server: ServerConnection.key(server.conn), project: project.worktree })
  }

  return (
    <>
      <Menu placement="bottom-start" gutter={4} modal={false} onOpenChange={onOpenChange}>
        <Menu.Trigger
          data-slot="session-location-trigger"
          data-separator={props.trailing ? separator() : undefined}
          class="flex h-6 min-w-0 max-w-[60%] shrink items-center gap-1.5 rounded-md ps-1 pe-2 text-start text-[13px] font-[440] leading-[var(--line-height-compact)] tracking-[-0.04px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-hover data-[expanded]:text-v2-text-text-base"
        >
          <ProjectAvatar
            class="shrink-0"
            aria-hidden="true"
            fallback={projectName()}
            src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
            variant={getProjectAvatarVariant(props.project?.icon?.color)}
          />
          <bdi dir="auto" data-slot="session-location-project" class="min-w-0 truncate">
            {projectName()}
          </bdi>
          <Show when={!props.compact && worktree()}>
            {(name) => (
              <>
                <span class="shrink-0 px-1 text-[11px] font-medium text-v2-text-text-faint" aria-hidden="true">
                  /
                </span>
                <Icon name="outline-worktree" class="shrink-0 text-v2-icon-icon-muted" />
                <bdi dir="auto" data-slot="session-location-worktree" class="min-w-12 shrink-[1000] truncate">
                  {name()}
                </bdi>
              </>
            )}
          </Show>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            data-slot="session-location-card"
            class="w-[320px] max-w-[calc(100vw-16px)]"
            aria-label={projectName()}
          >
            <Menu.Item class="min-w-0" disabled={!props.project} onSelect={openProject}>
              <ProjectAvatar
                class="shrink-0"
                aria-hidden="true"
                fallback={projectName()}
                src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
                variant={getProjectAvatarVariant(props.project?.icon?.color)}
              />
              <bdi dir="auto" class="min-w-0 truncate font-[530]">
                {projectName()}
              </bdi>
            </Menu.Item>
            <Show when={worktree() || git()}>
              <SessionLocationDetail icon={worktree() ? "outline-worktree" : "monitor"}>
                {worktree() ?? language.t("session.new.workspace.local")}
              </SessionLocationDetail>
            </Show>
            <Show when={git()}>
              <SessionLocationDetail icon="branch">
                <Show
                  when={branch()}
                  fallback={
                    <span class="flex min-w-0 items-center gap-1.5">
                      <span class="shrink-0 whitespace-nowrap">{language.t("session.location.noBranch")}</span>
                      <Show when={baseBranch()}>
                        {(base) => (
                          <>
                            <span class="text-v2-text-text-muted">·</span>
                            <span class="truncate text-v2-text-text-faint">
                              {language.t("session.summary.basedOn", { branch: base() })}
                            </span>
                          </>
                        )}
                      </Show>
                    </span>
                  }
                >
                  {branch()}
                </Show>
              </SessionLocationDetail>
            </Show>
            <SessionLocationDetail icon="server">
              <ServerLabel server={server.conn} hint />
            </SessionLocationDetail>
            <Show when={props.directory}>
              {(directory) => (
                <>
                  <Menu.Separator />
                  <div
                    data-slot="session-location-path"
                    class="flex min-w-0 gap-2 px-3 py-1.5 text-[12px] leading-4 text-v2-text-text-muted"
                  >
                    <Icon name="folder" class="shrink-0 text-v2-icon-icon-muted" />
                    <bdi dir="ltr" class="min-w-0 select-text break-all">
                      {directory()}
                    </bdi>
                  </div>
                  <Menu.Item onSelect={() => void copyPath()}>
                    <Icon name="outline-copy" class="text-v2-icon-icon-muted" />
                    {language.t("session.location.copyPath")}
                  </Menu.Item>
                  <Show when={canReveal()}>
                    <Menu.Item onSelect={reveal}>
                      <Icon name="outline-arrow-up-right" class="text-v2-icon-icon-muted" />
                      {language.t(fileManagerApp(platform.os ?? "unknown").actionLabel)}
                    </Menu.Item>
                  </Show>
                </>
              )}
            </Show>
            <Menu.Separator />
            <Menu.Item disabled={!props.project} onSelect={openProjectSettings}>
              <Icon name="settings-gear" class="text-v2-icon-icon-muted" />
              {language.t("project.settings.title")}
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
      <Show when={props.trailing && separator() !== "chip"}>
        <span
          data-slot="session-title-separator"
          data-variant={separator()}
          class="session-location-separator shrink-0 text-[11px] font-medium text-v2-text-text-faint"
          aria-hidden="true"
        >
          {separator() === "slash" ? "/" : undefined}
        </span>
      </Show>
    </>
  )
}

function SessionLocationDetail(props: ParentProps<{ icon: ComponentProps<typeof Icon>["name"] }>) {
  return (
    <div class="flex h-7 min-w-0 items-center gap-2 px-3 text-[13px] font-[440] leading-[var(--line-height-compact)] tracking-[-0.04px] text-v2-text-text-base">
      <Icon name={props.icon} class="shrink-0 text-v2-icon-icon-muted" />
      <span class="flex min-w-0 truncate">{props.children}</span>
    </div>
  )
}

export function SessionAncestorTrail(props: {
  sessionID: string
  parentID: string
  parentTitle?: string
  trailing: boolean
}) {
  const server = useServer()
  const language = useLanguage()
  const open = useOpenSessionRoute()

  const ancestors = createMemo(() => {
    const path: { id: string; title: string; direct: boolean }[] = []
    const seen = new Set([props.sessionID])
    let id: string | undefined = props.parentID

    while (id && !seen.has(id)) {
      seen.add(id)
      const info = server.ctx.data.session.get(id)
      path.unshift({
        id,
        title:
          sessionTitle(info?.title ?? (id === props.parentID ? props.parentTitle : undefined)) ??
          language.t("session.tab.session"),
        direct: id === props.parentID,
      })
      id = info?.parentID
    }

    return path
  })

  return (
    <div class="flex min-w-0 max-w-full items-center">
      <div
        data-slot="session-title-ancestors"
        class="flex min-w-0 items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <For each={ancestors()}>
          {(ancestor, index) => (
            <>
              <button
                type="button"
                data-slot={ancestor.direct ? "session-title-parent" : "session-title-ancestor"}
                data-session-id={ancestor.id}
                title={ancestor.title}
                class="max-w-[min(200px,40vw)] shrink-0 truncate text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:text-v2-text-text-muted"
                classList={{ "ps-1": index() === 0, "ps-2": index() > 0 }}
                onClick={() => open(props.sessionID, ancestor.id)}
              >
                <bdi dir="auto">{ancestor.title}</bdi>
              </button>
              <Show when={index() < ancestors().length - 1}>
                <span
                  data-slot="session-title-separator"
                  class="-translate-y-[0.5px] shrink-0 ps-2 pe-1 text-[11px] font-medium text-v2-text-text-faint"
                  aria-hidden="true"
                >
                  /
                </span>
              </Show>
            </>
          )}
        </For>
      </div>
      <Show when={props.trailing}>
        <span
          data-slot="session-title-separator"
          class="-translate-y-[0.5px] shrink-0 ps-2 pe-1 text-[11px] font-medium text-v2-text-text-faint"
          aria-hidden="true"
        >
          /
        </span>
      </Show>
    </div>
  )
}

// Opens a related session in the tab showing `from`, and records its parent so the tab's route stays consistent.
// `reveal` names a tool call or shell the opened timeline scrolls to and expands.
export function useOpenSessionRoute() {
  const server = useServer()
  const tabs = useTabs()
  const navigate = useNavigate()

  return (from: string, id: string, reveal?: string) => {
    const tab = tabs.store.find(
      (item) =>
        item.type === "session" &&
        item.server === server.key &&
        (item.sessionId === from || item.routeSessionId === from),
    )

    if (tab?.type === "session") tabs.rememberSessionRoute(tab, id, server.ctx.data.session.get(id)?.parentID)
    navigate(sessionHref(server.key, id), reveal ? { state: { reveal } } : undefined)
  }
}

export function SessionIdentityHeader(props: { sessionID: string; session?: SessionInfo }) {
  const server = useServer()
  const tabs = useTabs()
  const language = useLanguage()
  const pending = createMemo(() => tabs.pendingSession(server.key, props.sessionID))

  const tab = createMemo(() =>
    tabs.store.find(
      (item) =>
        item.type === "session" &&
        item.server === server.key &&
        (item.sessionId === props.sessionID || item.routeSessionId === props.sessionID),
    ),
  )

  const info = createMemo(() => {
    const current = tab()

    return current ? tabs.info[tabKey(current)] : undefined
  })

  const parentID = createMemo(() => {
    if (props.session?.parentID) return props.session.parentID
    const current = tab()

    if (current?.type !== "session" || current.routeSessionId !== props.sessionID) return

    return current.routeParentId ?? current.sessionId
  })

  const parent = createMemo(() => {
    const id = parentID()

    return id ? server.ctx.data.session.get(id) : undefined
  })

  const parentTitle = createMemo(() => {
    const id = parentID()
    const current = tab()

    return sessionTitle(
      parent()?.title ?? (current?.type === "session" && current.sessionId === id ? info()?.title : undefined),
    )
  })

  const directory = createMemo(
    () => props.session?.location.directory ?? pending()?.draft.directory ?? info()?.directory,
  )

  const title = createMemo(() =>
    pending()
      ? language.t("session.tab.session")
      : sessionTitle(props.session?.title ?? (parentID() ? undefined : info()?.title)),
  )

  const project = createMemo(() => {
    if (props.session) return server.ctx.projects.forSession(props.session)
    const projects = server.ctx.projects.list()
    const value = directory()

    if (!value) return undefined
    const key = pathKey(value)

    return (
      projects.find(
        (item) => pathKey(item.worktree) === key || item.sandboxes?.some((sandbox) => pathKey(sandbox) === key),
      ) ?? server.ctx.sync.data.project.find((item) => isProjectDirectory(item, value))
    )
  })

  return (
    <Show when={title() || parentTitle()}>
      <SessionTitleHeader>
        <SessionHeaderLayout
          location={
            <>
              <SessionLocation
                project={project()}
                directory={directory()}
                compact={!!parentID()}
                trailing={!!(title() || parentID())}
              />
              <Show when={parentID()}>
                {(id) => (
                  <SessionAncestorTrail
                    sessionID={props.sessionID}
                    parentID={id()}
                    parentTitle={parentTitle()}
                    trailing={!!title()}
                  />
                )}
              </Show>
            </>
          }
        >
          <SessionWorkingIndicator sessionID={props.sessionID} />
          <Show when={title()}>
            {(value) => (
              <h1
                data-slot={parentID() ? "session-title-child" : undefined}
                dir="auto"
                class="w-fit truncate rounded-[6px] px-1 py-1 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base"
                classList={{ "max-w-[45%] shrink-0": !!parentID() }}
              >
                {value()}
              </h1>
            )}
          </Show>
        </SessionHeaderLayout>
      </SessionTitleHeader>
    </Show>
  )
}
