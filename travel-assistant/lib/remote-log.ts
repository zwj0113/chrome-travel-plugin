import { MSG } from './messages';

function forward(level: 'log' | 'warn' | 'error', args: unknown[]) {
  const message = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  // 同时打印到本地控制台（方便就近调试）
  const line = `[travel-assistant] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  // 转发到 Service Worker 控制台
  chrome.runtime.sendMessage({
    type: MSG.REMOTE_LOG,
    level,
    message,
  }).catch(() => {});
}

export function remoteLog(...args: unknown[]) {
  forward('log', args);
}

export function remoteWarn(...args: unknown[]) {
  forward('warn', args);
}

export function remoteError(...args: unknown[]) {
  forward('error', args);
}
