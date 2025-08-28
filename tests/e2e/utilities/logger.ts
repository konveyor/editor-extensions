export class TestLogger {
  private logLevel: string;

  constructor(
    private context: string,
    logLevel: string = 'INFO'
  ) {
    // Set log level from environment variable or default to INFO
    this.logLevel = process.env.TEST_LOG_LEVEL || logLevel;
  }

  private shouldLog(level: string): boolean {
    const levels = ['ERROR', 'WARN', 'SUCCESS', 'INFO', 'DEBUG'];
    const currentLevelIndex = levels.indexOf(this.logLevel.toUpperCase());
    const messageLevelIndex = levels.indexOf(level.toUpperCase());

    return messageLevelIndex <= currentLevelIndex;
  }

  private log(level: string, message: string): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] [${this.context}] ${message}`);
  }

  info(message: string): void {
    this.log('INFO', message);
  }

  success(message: string): void {
    this.log('SUCCESS', `${message}`);
  }

  warn(message: string): void {
    this.log('WARN', `${message}`);
  }

  error(message: string): void {
    this.log('ERROR', `${message}`);
  }

  debug(message: string): void {
    this.log('DEBUG', `${message}`);
  }
}
