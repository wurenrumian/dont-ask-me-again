import { App, FuzzySuggestModal } from "obsidian";

export type SessionPickerItem =
  | { type: "new" }
  | { type: "clear" }
  | { type: "history"; sessionId: string; isActive: boolean; updatedAt?: string | null };

interface SessionPickerModalOptions {
  sessions: { sessionId: string; updatedAt?: string | null }[];
  activeSessionId: string | null;
  onChoose: (item: SessionPickerItem) => void;
}

export class SessionPickerModal extends FuzzySuggestModal<SessionPickerItem> {
  private readonly items: SessionPickerItem[];
  private readonly onChoose: SessionPickerModalOptions["onChoose"];

  constructor(app: App, options: SessionPickerModalOptions) {
    super(app);
    this.setPlaceholder("Select session action...");
    this.onChoose = options.onChoose;
    const historyItems: SessionPickerItem[] = options.sessions.map((entry) => ({
      type: "history",
      sessionId: entry.sessionId,
      isActive: options.activeSessionId === entry.sessionId,
      updatedAt: entry.updatedAt
    }));
    this.items = [{ type: "new" }, { type: "clear" }, ...historyItems];
  }

  getItems(): SessionPickerItem[] {
    return this.items;
  }

  getItemText(item: SessionPickerItem): string {
    if (item.type === "new") {
      return "Start New Session";
    }
    if (item.type === "clear") {
      return "Exit Session";
    }
    const activeTag = item.isActive ? " (active)" : "";
    const updatedAt = item.updatedAt ? ` - ${item.updatedAt}` : "";
    return `${item.sessionId}${activeTag}${updatedAt}`;
  }

  onChooseItem(item: SessionPickerItem): void {
    this.onChoose(item);
  }
}
