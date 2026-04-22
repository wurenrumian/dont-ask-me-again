export class SessionManager {
  private activeSessionId: string | null = null;
  private pendingNewSession = false;

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  hasPendingNewSession(): boolean {
    return this.pendingNewSession;
  }

  beginNewSession(): void {
    this.activeSessionId = null;
    this.pendingNewSession = true;
  }

  setActiveSessionId(sessionId: string): void {
    this.activeSessionId = sessionId;
    this.pendingNewSession = false;
  }

  clearActiveSessionId(): void {
    this.activeSessionId = null;
    this.pendingNewSession = false;
  }

  getStatusLabel(): string {
    if (this.activeSessionId) {
      return `Session: ${this.activeSessionId}`;
    }

    if (this.pendingNewSession) {
      return "Session: new";
    }

    return "No Session";
  }
}
