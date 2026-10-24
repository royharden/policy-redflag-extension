interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface ChromeMessageSender {
  tab?: { id?: number };
}

declare const chrome: {
  action: {
    onClicked: {
      addListener(callback: (tab: { id?: number; windowId?: number }) => void): void;
    };
  };
  sidePanel: {
    open(options: { windowId: number }): Promise<void>;
  };
  runtime: {
    onInstalled: { addListener(callback: () => void): void };
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: ChromeMessageSender,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    sendMessage(message: unknown): Promise<unknown>;
  };
  scripting: {
    executeScript(options: { target: { tabId: number }; files: string[] }): Promise<unknown>;
  };
  tabs: {
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  storage: {
    local: StorageArea;
    session: StorageArea;
    onChanged: {
      addListener(callback: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void;
    };
  };
  permissions: {
    request(permissions: { origins: string[] }): Promise<boolean>;
  };
};
