function loggerDateString() {
  return process.env.ENVIRONMENT === "production"
    ? ""
    : new Date().toISOString() + " ";
}

class Logger {
  instanceId: string;
  logLevel: string;

  constructor() {
    this.instanceId = '';
    this.logLevel = 'DEBUG';
  }

  init(instanceId: string) {
    this.instanceId = instanceId;
  }

  setLogLevel(level: string) {
    this.logLevel = level;
  }

  log(level: string, message: any) {
    const levels = ["DEBUG", "INFO", "WARN", "ERROR"];
    if (levels.indexOf(level) >= levels.indexOf(this.logLevel)) {
      console.log(`${loggerDateString()}[${this.instanceId}] [${level}] ${message}`);
    }
  }

  debug(message: string) {
    this.log("DEBUG", message);
  }

  info(message: string) {
    this.log("INFO", message);
  }

  warn(message: string) {
    this.log("WARN", message);
  }

  error(message: any) {
    this.log("ERROR", message);
  }
}

const logger = new Logger();
export default logger;
