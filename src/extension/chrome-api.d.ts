// Minimal hand-written declarations for the chrome.* APIs this extension uses (no @types/chrome
// dependency). Only the members referenced in src/extension are declared.

declare namespace chrome {
  namespace events {
    interface Event<T extends (...args: never[]) => unknown> {
      addListener(callback: T): void;
      removeListener(callback: T): void;
    }
  }

  namespace tabs {
    interface Tab {
      id?: number;
      windowId?: number;
      url?: string;
      title?: string;
      active?: boolean;
    }
    interface MessageOptions {
      frameId?: number;
      documentId?: string;
    }
    function sendMessage(tabId: number, message: unknown, options?: MessageOptions): Promise<unknown>;
    function query(queryInfo: { active?: boolean; windowId?: number; currentWindow?: boolean }): Promise<Tab[]>;
    const onRemoved: events.Event<(tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void>;
    const onUpdated: events.Event<(tabId: number, changeInfo: { status?: string; url?: string }, tab: Tab) => void>;
    const onActivated: events.Event<(activeInfo: { tabId: number; windowId: number }) => void>;
    const onReplaced: events.Event<(addedTabId: number, removedTabId: number) => void>;
  }

  namespace windows {
    interface Window {
      id?: number;
    }
    function getCurrent(): Promise<Window>;
  }

  namespace runtime {
    const id: string;
    interface MessageSender {
      id?: string;
      url?: string;
      tab?: tabs.Tab;
      frameId?: number;
      documentId?: string;
      origin?: string;
    }
    function getURL(path: string): string;
    function getManifest(): { version: string; name: string };
    function sendMessage(message: unknown): Promise<unknown>;
    const onInstalled: events.Event<() => void>;
    const onMessage: events.Event<
      (message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | undefined | void
    >;
  }

  namespace action {
    const onClicked: events.Event<(tab: tabs.Tab) => void>;
  }

  namespace sidePanel {
    function open(options: { windowId?: number; tabId?: number }): Promise<void>;
  }

  namespace scripting {
    interface InjectionResult {
      documentId?: string;
      frameId: number;
      result?: unknown;
    }
    function executeScript(injection: { target: { tabId: number; frameIds?: number[] }; files: string[] }): Promise<InjectionResult[]>;
  }

  namespace storage {
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }
    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      getBytesInUse(keys?: string | string[] | null): Promise<number>;
    }
    interface SessionStorageArea extends StorageArea {
      setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }): Promise<void>;
    }
    const local: StorageArea;
    const session: SessionStorageArea;
    const onChanged: events.Event<(changes: Record<string, StorageChange>, areaName: string) => void>;
  }
}
