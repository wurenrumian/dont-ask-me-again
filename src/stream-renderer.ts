export interface StreamRendererOptions {
  updateThinking: (text: string) => void;
  updateAnswer: (text: string) => void;
  onChanged: () => void;
}

interface StreamRenderState {
  startedAt: number;
  thinkingText: string;
  answerText: string;
  thinkingQueue: string;
  answerQueue: string;
  fallbackThinkingText: string;
  fallbackThinkingCursor: number;
  lastFallbackTickAt: number;
  hasRealThinking: boolean;
  answerStarted: boolean;
  done: boolean;
  rafId: number | null;
  resolveDrain: (() => void) | null;
  drained: Promise<void>;
}

export class StreamRenderer {
  private readonly state: StreamRenderState;

  constructor(private readonly options: StreamRendererOptions) {
    this.state = this.createState();
  }

  pushThinking(delta: string): void {
    this.state.hasRealThinking = true;
    if (
      this.state.fallbackThinkingCursor > 0
      && this.state.thinkingText
        === this.state.fallbackThinkingText.slice(0, this.state.fallbackThinkingCursor)
    ) {
      this.state.thinkingText = "";
      this.state.fallbackThinkingCursor = 0;
    }
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
      startedAt: performance.now(),
      thinkingText: "",
      answerText: "",
      thinkingQueue: "",
      answerQueue: "",
      fallbackThinkingText: "Streaming Reasoning / Streaming Thoughts...",
      fallbackThinkingCursor: 0,
      lastFallbackTickAt: 0,
      hasRealThinking: false,
      answerStarted: false,
      done: false,
      rafId: null,
      resolveDrain: null,
      drained: Promise.resolve()
    } as StreamRenderState;
    state.drained = new Promise<void>((resolve) => {
      state.resolveDrain = resolve;
    });
    return state;
  }

  private ensurePump(): void {
    if (this.state.rafId !== null) {
      return;
    }

    const step = () => {
      this.state.rafId = null;
      let changed = false;
      const minThinkingVisibleMs = 420;
      const allowSwitchToAnswer = this.state.hasRealThinking
        || (performance.now() - this.state.startedAt) >= minThinkingVisibleMs
        || this.state.fallbackThinkingCursor >= this.state.fallbackThinkingText.length;

      if (!this.state.answerStarted && this.state.thinkingQueue.length > 0) {
        const charsPerFrame = this.computeCharsPerFrame(this.state.thinkingQueue.length);
        const chunk = this.state.thinkingQueue.slice(0, charsPerFrame);
        this.state.thinkingQueue = this.state.thinkingQueue.slice(charsPerFrame);
        this.state.thinkingText += chunk;
        this.options.updateThinking(this.state.thinkingText);
        changed = true;
      }

      if (
        !this.state.answerStarted
        && !this.state.done
        && this.state.thinkingQueue.length === 0
      ) {
        const now = performance.now();
        if (
          this.state.fallbackThinkingCursor < this.state.fallbackThinkingText.length
          && now - this.state.lastFallbackTickAt >= 30
        ) {
          this.state.fallbackThinkingCursor += 1;
          this.state.lastFallbackTickAt = now;
          this.state.thinkingText = this.state.fallbackThinkingText.slice(
            0,
            this.state.fallbackThinkingCursor
          );
          this.options.updateThinking(this.state.thinkingText);
          changed = true;
        }
      }

      if (this.state.answerQueue.length > 0 && allowSwitchToAnswer) {
        this.state.answerStarted = true;
        const charsPerFrame = this.computeCharsPerFrame(this.state.answerQueue.length);
        const chunk = this.state.answerQueue.slice(0, charsPerFrame);
        this.state.answerQueue = this.state.answerQueue.slice(charsPerFrame);
        this.state.answerText += chunk;
        this.options.updateAnswer(this.state.answerText);
        changed = true;
      }

      if (changed) {
        this.options.onChanged();
      }

      if (
        this.state.thinkingQueue.length > 0
        || this.state.answerQueue.length > 0
        || (
          !this.state.done
          && !this.state.answerStarted
          && this.state.fallbackThinkingCursor < this.state.fallbackThinkingText.length
        )
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

    this.state.rafId = window.requestAnimationFrame(step);
  }

  private computeCharsPerFrame(queueLen: number): number {
    const adaptive = Math.ceil(queueLen / 28);
    return Math.max(1, Math.min(12, adaptive));
  }
}
