/**
 * 流水线运行日志——收集所有运行细节，最后输出为 .log 文件。
 */
export interface LogEntry {
  time: string;   // HH:MM:SS.mmm
  level: 'INFO' | 'WARN' | 'ERROR';
  step: string;   // 所属步骤 id
  message: string;
}

class PipelineLogger {
  private entries: LogEntry[] = [];
  private startTime = Date.now();

  private ts(): string {
    const elapsed = Date.now() - this.startTime;
    const h = Math.floor(elapsed / 3600000);
    const m = Math.floor((elapsed % 3600000) / 60000);
    const s = Math.floor((elapsed % 60000) / 1000);
    const ms = elapsed % 1000;
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR', step: string, message: string) {
    this.entries.push({ time: this.ts(), level, step, message });
    const label = `[${level}] [${step}]`;
    const line = `[travel-assistant] ${label} ${message}`;
    if (level === 'ERROR') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
  }

  info(step: string, message: string) {
    this.log('INFO', step, message);
  }

  warn(step: string, message: string) {
    this.log('WARN', step, message);
  }

  error(step: string, message: string) {
    this.log('ERROR', step, message);
  }

  getAll(): LogEntry[] {
    return this.entries;
  }

  toString(): string {
    const now = new Date().toISOString();
    const header = [
      `# 旅游攻略助手 · 运行日志`,
      `# 生成时间: ${now}`,
      `# 共 ${this.entries.length} 条记录`,
      '',
    ];
    const body = this.entries.map(e =>
      `[${e.time}] [${e.level}] [${e.step}] ${e.message}`
    );
    return [...header, ...body].join('\n');
  }
}

export function createLogger(): PipelineLogger {
  return new PipelineLogger();
}
