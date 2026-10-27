/**
 * Logger utility for test framework
 * Provides structured logging with different levels
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private className: string;
  private logLevel: LogLevel;

  constructor(className: string) {
    this.className = className;
    this.logLevel = this.getLogLevelFromEnv();
  }

  private getLogLevelFromEnv(): LogLevel {
    const level = process.env.LOG_LEVEL?.toUpperCase() || "INFO";
    return LogLevel[level as keyof typeof LogLevel] ?? LogLevel.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${this.className}] ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.formatMessage("DEBUG", message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage("INFO", message), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage("WARN", message), ...args);
    }
  }

  error(message: string, error?: Error, ...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      if (error) {
        console.error(
          this.formatMessage("ERROR", message),
          error.stack,
          ...args,
        );
      } else {
        console.error(this.formatMessage("ERROR", message), ...args);
      }
    }
  }

  step(stepName: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage("STEP", `🔹 ${stepName}`));
    }
  }

  action(actionName: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage("ACTION", `▶️ ${actionName}`));
    }
  }

  assertion(assertionName: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage("ASSERT", `✅ ${assertionName}`));
    }
  }

  failure(failureMessage: string): void {
    console.error(this.formatMessage("FAIL", `❌ ${failureMessage}`));
  }
}
