import { Menu } from "obsidian";
import { buildArborBlockLink } from "../../blockLinks";
import { getChildArrowIcon, getParentArrowIcon } from "../../layoutDirection";
import { cloneMetadata, getBlock, getChildren, getParentBlock } from "../../model/tree";
import { FULL_OUTPUT_PROFILE_ID, setBlockOnlyState, setSubtreeState } from "../../outputProfiles";
import type { ArborOutputProfile, ArborOutputState, ArborSettings, BranchBlockId } from "../../types";
import { deepClone, extractPathLabel } from "../../utils";
import type { OutputProfilesController } from "../OutputProfilesModal";
import { getBlockOutputMenuActions } from "../output/outputPresentation";
import type { EditorPort, SelectionPort, ViewReadPort } from "../state/viewTypes";
import { ViewWorkScope } from "../runtime/ViewWorkScope";

export interface MenuCommands {
  createChild(): Promise<void>;
  createParentLevelBlock(): Promise<void>;
  createSiblingAbove(): Promise<void>;
  createSiblingBelow(): Promise<void>;
  selectParentBlock(): void;
  selectPreviousSiblingBlock(): void;
  selectNextSiblingBlock(): void;
  selectFirstChildBlock(): void;
  toggleCollapsedState(id: BranchBlockId): Promise<void>;
  duplicateSelectedSubtree(): Promise<void>;
  revealCurrentBlockInMarkdown(): Promise<void>;
  deleteSelectedBlock(): Promise<void>;
  deleteSelectedSubtree(): Promise<void>;
  openTreeOverview(): void;
  closeTreeOverview(): void;
  openOutputPreview(): void;
  closeOutputPreview(): void;
  exportCleanCopy(): Promise<void>;
  exportTreeOverview(): Promise<void>;
}

export interface ViewMenusPort {
  read: ViewReadPort;
  selection: SelectionPort;
  editor: EditorPort;
  commands: MenuCommands;
  getRoot(): HTMLElement;
  getViewMenuButton(): HTMLButtonElement | null;
  getProfileButton(): HTMLButtonElement | null;
  runWithSelectedBlock(id: BranchBlockId, action: () => Promise<void>): Promise<void>;
  openSearchOverlay(): void;
  updateZoomLevel(value: number): void;
  syncOverviewZoom(): void;
  openCurrentFileInMarkdown(): Promise<void>;
  updateViewSetting<Key extends keyof ArborSettings>(key: Key, value: ArborSettings[Key], refreshAll?: boolean): Promise<void>;
  openArborSettings(): void;
  activateOutputProfile(id: string): Promise<ArborOutputState>;
  applyActiveOutputProfile(state: ArborOutputState): Promise<ArborOutputState>;
  applyOutputProfileMutation(label: string, state: ArborOutputState): Promise<ArborOutputState>;
  resetInvalidOutputProfiles(): Promise<ArborOutputState>;
  applyOutputMutation(label: string, mutate: (profile: ArborOutputProfile) => ArborOutputProfile): Promise<void>;
  openProfiles(controller: OutputProfilesController): void;
  writeClipboard(text: string): Promise<void>;
  showCopyLinkFallback(text: string): void;
  reportError(message: string, error: unknown): void;
}

export class ViewMenus {
  private readonly work = new ViewWorkScope();
  constructor(private readonly port: ViewMenusPort) {}

  reset(): void {
    this.work.reset();
  }

  openViewMenu(event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    const menu = new Menu();
    const settings = this.port.read.getSettings();
    menu.addItem((item) =>
      item.setTitle("Search blocks").setIcon("search").onClick(() => this.port.openSearchOverlay())
    );
    for (const [label, icon, factor] of [["Zoom in", "zoom-in", 1.15], ["Zoom out", "zoom-out", 1 / 1.15]] as const) {
      menu.addItem((item) =>
        item.setTitle(label).setIcon(icon).onClick(() => {
          this.port.updateZoomLevel(this.port.read.getSettings().zoomLevel * factor);
        })
      );
    }
    menu.addItem((item) =>
      item.setTitle("Open in Markdown").setIcon("file-text").onClick(() => void this.port.openCurrentFileInMarkdown())
    );
    menu.addItem((item) =>
      this.port.read.getMode() === "output"
        ? item.setTitle("Return to branch editor").setIcon("git-fork").onClick(() => this.port.commands.closeOutputPreview())
        : item.setTitle("Output preview").setIcon("file-check-2").onClick(() => this.port.commands.openOutputPreview())
    );
    menu.addItem((item) =>
      item.setTitle("Export clean copy…").setIcon("file-output").onClick(() => void this.port.commands.exportCleanCopy())
    );
    menu.addItem((item) =>
      item.setTitle("Export tree overview…").setIcon("image-down").onClick(() => void this.port.commands.exportTreeOverview())
    );
    menu.addItem((item) =>
      this.port.read.getMode() === "overview"
        ? item.setTitle("Return to branch editor").setIcon("git-fork").onClick(() => this.port.commands.closeTreeOverview())
        : item.setTitle("Tree overview").setIcon("map").onClick(() => this.port.commands.openTreeOverview())
    );
    menu.addSeparator();
    this.addViewToggleMenuItem(menu, "Selected block panel", settings.liveLinearPreview, () =>
      this.port.updateViewSetting("liveLinearPreview", !this.port.read.getSettings().liveLinearPreview)
    );
    this.addViewToggleMenuItem(menu, "Breadcrumb path", settings.showBreadcrumb, () =>
      this.port.updateViewSetting("showBreadcrumb", !this.port.read.getSettings().showBreadcrumb)
    );
    this.addViewToggleMenuItem(menu, "Breadcrumb flow", settings.showBreadcrumbFlow, () =>
      this.port.updateViewSetting("showBreadcrumbFlow", !this.port.read.getSettings().showBreadcrumbFlow)
    );
    this.addViewToggleMenuItem(menu, "Ctrl/Cmd + wheel zoom", settings.enableCtrlWheelZoom, () =>
      this.port.updateViewSetting("enableCtrlWheelZoom", !this.port.read.getSettings().enableCtrlWheelZoom, false)
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Reset zoom to 100%").setIcon("maximize").onClick(() => this.port.updateZoomLevel(1))
    );
    menu.addItem((item) =>
      item.setTitle("Open settings").setIcon("settings-2").onClick(() => this.port.openArborSettings())
    );
    const anchor = this.port.getViewMenuButton();
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right - 8, y: rect.bottom + 6 }, anchor.ownerDocument);
      return;
    }
    menu.showAtPosition({ x: 220, y: 120 }, this.port.getRoot().ownerDocument);
  }

  openOutputProfileMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const state = this.port.read.getState();
    if (!state) {
      return;
    }
    const menu = new Menu();
    const profiles = [
      { id: FULL_OUTPUT_PROFILE_ID, name: "Full tree" },
      ...state.outputState.profiles.map((profile) => ({ id: profile.id, name: profile.name }))
    ];
    profiles.forEach((profile) => {
      menu.addItem((item) =>
        item
          .setTitle(profile.name)
          .setIcon(profile.id === this.port.read.getState()?.outputState.activeProfileId ? "check" : "circle")
          .setDisabled(Boolean(this.port.read.getState()?.outputError))
          .onClick(() => void this.port.activateOutputProfile(profile.id))
      );
    });
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Manage output profiles…").setIcon("list-tree").onClick(() => this.openOutputProfilesManager())
    );
    const anchor = this.port.getProfileButton();
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 6 }, anchor.ownerDocument);
    }
  }

  buildBlockMenu(blockId: BranchBlockId): Menu {
    const menu = new Menu();
    const state = this.port.read.getState();
    menu.addItem((item) =>
      item.setTitle("Edit block").setIcon("pencil").onClick(() => {
        this.port.editor.beginEditingBlock(blockId, this.port.read.getMode() === "overview" ? "overview" : "card");
      })
    );
    const canCreateLeft = state ? Boolean(getParentBlock(state.metadata, blockId)) : false;
    const childCount = state ? getChildren(state.metadata, blockId).length : 0;
    const block = state ? getBlock(state.metadata, blockId) : null;
    const direction = this.port.read.getSettings().layoutDirection;
    menu.addItem((item) =>
      item.setTitle("Create child").setIcon(getChildArrowIcon(direction)).onClick(() =>
        void this.port.runWithSelectedBlock(blockId, () => this.port.commands.createChild())
      )
    );
    if (canCreateLeft) {
      menu.addItem((item) =>
        item.setTitle("Create at parent level").setIcon(getParentArrowIcon(direction)).onClick(() =>
          void this.port.runWithSelectedBlock(blockId, () => this.port.commands.createParentLevelBlock())
        )
      );
    }
    menu.addItem((item) =>
      item.setTitle("Create sibling above").setIcon("arrow-up").onClick(() =>
        void this.port.runWithSelectedBlock(blockId, () => this.port.commands.createSiblingAbove())
      )
    )
      .addItem((item) =>
        item.setTitle("Create sibling below").setIcon("arrow-down").onClick(() =>
          void this.port.runWithSelectedBlock(blockId, () => this.port.commands.createSiblingBelow())
        )
      )
      .addSeparator()
      .addItem((item) =>
        item.setTitle("Select parent").setIcon("corner-up-left").onClick(() =>
          this.runNavigation(blockId, () => this.port.commands.selectParentBlock())
        )
      )
      .addItem((item) =>
        item.setTitle("Select previous sibling").setIcon("chevron-up").onClick(() =>
          this.runNavigation(blockId, () => this.port.commands.selectPreviousSiblingBlock())
        )
      )
      .addItem((item) =>
        item.setTitle("Select next sibling").setIcon("chevron-down").onClick(() =>
          this.runNavigation(blockId, () => this.port.commands.selectNextSiblingBlock())
        )
      )
      .addItem((item) =>
        item.setTitle("Select first child").setIcon("chevron-right").onClick(() =>
          this.runNavigation(blockId, () => this.port.commands.selectFirstChildBlock())
        )
      );
    if (childCount > 0 && block) {
      menu.addItem((item) =>
        item
          .setTitle(block.collapsed ? "Expand branch" : "Collapse branch")
          .setIcon(block.collapsed ? "chevrons-down-up" : "chevrons-up-down")
          .onClick(() => void this.port.runWithSelectedBlock(blockId, () => this.port.commands.toggleCollapsedState(blockId)))
      );
    }
    menu.addSeparator();
    this.addBlockOutputMenuItems(menu, blockId);
    menu.addSeparator()
      .addItem((item) => item.setTitle("Copy block link").setIcon("link").onClick(() => void this.copyBlockLink(blockId)))
      .addItem((item) => item.setTitle("Duplicate subtree").setIcon("copy-plus").onClick(() => void this.port.runWithSelectedBlock(blockId, () => this.port.commands.duplicateSelectedSubtree())))
      .addItem((item) => item.setTitle("Reveal in Markdown").setIcon("file-text").onClick(() => void this.port.runWithSelectedBlock(blockId, () => this.port.commands.revealCurrentBlockInMarkdown())))
      .addSeparator()
      .addItem((item) => item.setTitle("Delete block").setIcon("trash").setWarning(true).onClick(() => void this.port.runWithSelectedBlock(blockId, () => this.port.commands.deleteSelectedBlock())))
      .addItem((item) => item.setTitle("Delete subtree").setIcon("trash-2").setWarning(true).onClick(() => void this.port.runWithSelectedBlock(blockId, () => this.port.commands.deleteSelectedSubtree())));
    this.applyDangerMenuItemStyles(menu);
    return menu;
  }

  private openOutputProfilesManager(): void {
    const state = this.port.read.getState();
    if (!state) return;
    this.port.openProfiles({
      initialState: deepClone(state.outputState),
      metadata: cloneMetadata(state.metadata),
      selectedBlockId: state.selectedBlockId,
      outputError: state.outputError,
      activate: (next) => this.port.applyActiveOutputProfile(next),
      mutate: (label, next) => this.port.applyOutputProfileMutation(label, next),
      reset: () => this.port.resetInvalidOutputProfiles(),
      closed: () => undefined
    });
  }

  private addViewToggleMenuItem(menu: Menu, title: string, enabled: boolean, callback: () => void | Promise<void>): void {
    menu.addItem((item) => item.setTitle(title).setIcon(enabled ? "check" : "circle").onClick(() => void callback()));
  }

  private addBlockOutputMenuItems(menu: Menu, blockId: BranchBlockId): void {
    const state = this.port.read.getState();
    if (!state) {
      return;
    }
    getBlockOutputMenuActions(state.outputState).forEach((action) => {
      menu.addItem((item) => {
        item
          .setTitle(action.label)
          .setIcon(action.icon)
          .setDisabled(Boolean(this.port.read.getState()?.outputError));
        if (action.id === "create-profile") {
          item.onClick(() => this.openOutputProfilesManager());
          return;
        }
        item.onClick(() => void this.port.applyOutputMutation(action.label, (profile) => {
          const current = this.port.read.getState();
          if (!action.state || !action.scope || !current) {
            return profile;
          }
          return action.scope === "block"
            ? setBlockOnlyState(current.metadata, profile, blockId, action.state)
            : setSubtreeState(current.metadata, profile, blockId, action.state);
        }));
      });
    });
  }

  private async copyBlockLink(blockId: BranchBlockId): Promise<void> {
    const state = this.port.read.getState();
    const block = state ? getBlock(state.metadata, blockId) : null;
    const filePath = this.port.read.getFilePath();
    if (!filePath || !block) {
      return;
    }
    const link = buildArborBlockLink(filePath, blockId, extractPathLabel(block.content));
    try {
      await this.port.writeClipboard(link);
    } catch (error) {
      this.port.reportError("[Arbor] Failed to copy block link", error);
      this.port.showCopyLinkFallback(link);
    }
  }

  private applyDangerMenuItemStyles(menu: Menu): void {
    const menuWithDom = menu as Menu & { dom?: HTMLElement };
    this.work.frame(window, () => {
      const menuEl = menuWithDom.dom;
      if (!menuEl) {
        return;
      }
      menuEl.querySelectorAll<HTMLElement>(".menu-item-title").forEach((titleEl) => {
        const text = titleEl.textContent?.trim();
        if (text === "Delete block" || text === "Delete subtree") {
          titleEl.closest(".menu-item")?.addClass("arbor-menu-danger");
        }
      });
    });
  }

  private runNavigation(blockId: BranchBlockId, action: () => void): void {
    void this.port.runWithSelectedBlock(blockId, () => {
      action();
      return Promise.resolve();
    });
  }
}
