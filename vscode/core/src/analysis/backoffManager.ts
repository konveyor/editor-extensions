export class BackoffManager {
  // next scheduled analysis runs after this delay
  private backoffTimer: NodeJS.Timeout | null = null;
  // reset the backoff delay when we are idle for a while
  private idleResetTimer: NodeJS.Timeout | null = null;

  private baseBackoffDelay: number;
  private maxBackoffDelay: number;
  private currentBackoffDelay: number;
  private idleResetDelay: number;
  private runningCallback: boolean = false;
  constructor(
    baseBackoffDelay: number = 1000,
    maxBackoffDelay: number = 30000,
    idleResetDelay: number = 10000,
  ) {
    this.baseBackoffDelay = baseBackoffDelay;
    this.maxBackoffDelay = maxBackoffDelay;
    this.currentBackoffDelay = baseBackoffDelay;
    this.idleResetDelay = idleResetDelay;
    this.runningCallback = false;
  }

  schedule(callback: () => void) {
    if (this.idleResetTimer) {
      clearTimeout(this.idleResetTimer);
    }
    this.idleResetTimer = setTimeout(() => this.resetBackoff(), this.idleResetDelay);

    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
    }
    this.backoffTimer = setTimeout(() => {
      if (!this.runningCallback) {
        this.runningCallback = true;
        callback();
        this.runningCallback = false;
      }
    }, this.currentBackoffDelay);
  }

  public isRunningCallback() {
    return this.runningCallback;
  }

  public increaseBackoff() {
    this.currentBackoffDelay = Math.min(this.currentBackoffDelay * 2, this.maxBackoffDelay);
  }

  private resetBackoff() {
    this.currentBackoffDelay = this.baseBackoffDelay;
  }

  cancel() {
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
  }

  dispose() {
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
    if (this.idleResetTimer) {
      clearTimeout(this.idleResetTimer);
      this.idleResetTimer = null;
    }
  }
}
