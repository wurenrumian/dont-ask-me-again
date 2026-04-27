export interface StreamRendererOptions {
  updateThinking: (text: string) => void;
  updateAnswer: (text: string) => void;
  onChanged: () => void;
}

interface StreamRenderState {
  thinkingText: string;
  answerText: string;
  thinkingQueue: string;
  answerQueue: string;
  hasRealThinking: boolean;
  answerStarted: boolean;
  done: boolean;
  rafId: number | null;
  timeoutId: number | null;
  lastRenderedAt: number | null;
  resolveDrain: (() => void) | null;
  drained: Promise<void>;
}

export class StreamRenderer {
  private static readonly minRenderIntervalMs = 80;
  private readonly state: StreamRenderState;

  constructor(private readonly options: StreamRendererOptions) {
    this.state = this.createState();
  }

  pushThinking(delta: string): void {
    this.state.hasRealThinking = true;
    this.state.thinkingQueue += delta;
    this.ensurePump();
  }

  pushAnswer(delta: string): void {
    if (
      !this.state.answerStarted
      && !this.state.hasRealThinking
      && delta.trim().length === 0
    ) {
      return;
    }
    this.state.answerQueue += delta;
    this.ensurePump();
  }

  finish(): void {
    this.state.done = true;
    this.ensurePump();
  }

  async waitForDrain(timeoutMs = 2500): Promise<void> {
    await Promise.race([
      this.state.drained,
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeoutMs);
      })
    ]);
  }

  private createState(): StreamRenderState {
    const state = {
      thinkingText: "",
      answerText: "",
      thinkingQueue: "",
      answerQueue: "",
      hasRealThinking: false,
      answerStarted: false,
      done: false,
      rafId: null,
      timeoutId: null,
      lastRenderedAt: null,
      resolveDrain: null,
      drained: Promise.resolve()
    } as StreamRenderState;
    state.drained = new Promise<void>((resolve) => {
      state.resolveDrain = resolve;
    });
    return state;
  }

  private ensurePump(): void {
    if (this.state.rafId !== null || this.state.timeoutId !== null) {
      return;
    }

    const step = () => {
      this.state.rafId = null;
      let changed = false;

      if (!this.state.answerStarted && this.state.thinkingQueue.length > 0) {
        const chunk = this.state.thinkingQueue;
        this.state.thinkingQueue = "";
        this.state.thinkingText += chunk;
        this.options.updateThinking(this.state.thinkingText);
        changed = true;
      }

      if (this.state.answerQueue.length > 0) {
        this.state.answerStarted = true;
        const chunk = this.state.answerQueue;
        this.state.answerQueue = "";
        this.state.answerText += chunk;
        this.options.updateAnswer(this.state.answerText);
        changed = true;
      }

      if (changed) {
        this.state.lastRenderedAt = performance.now();
        this.options.onChanged();
      }

      if (
        this.state.thinkingQueue.length > 0
        || this.state.answerQueue.length > 0
      ) {
        this.state.rafId = window.requestAnimationFrame(step);
        return;
      }

      if (this.state.done && this.state.resolveDrain) {
        const resolve = this.state.resolveDrain;
        this.state.resolveDrain = null;
        resolve();
      }
    };

    const now = performance.now();
    const elapsed = this.state.lastRenderedAt === null
      ? StreamRenderer.minRenderIntervalMs
      : now - this.state.lastRenderedAt;
    const delayMs = Math.max(0, StreamRenderer.minRenderIntervalMs - elapsed);

    if (delayMs > 0) {
      this.state.timeoutId = window.setTimeout(() => {
        this.state.timeoutId = null;
        this.state.rafId = window.requestAnimationFrame(step);
      }, delayMs);
      return;
    }

    this.state.rafId = window.requestAnimationFrame(step);
  }
}
