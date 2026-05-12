import { loadSettings, saveSettings } from '../../lib/config-manager';
import type { UserSettings } from '../../lib/types';

interface StoredLog { title: string; content: string; time: number; }

let settings: UserSettings;
let logs: StoredLog[] = [];

async function load() {
  settings = await loadSettings();

  (document.getElementById('siliflow-key') as HTMLInputElement).value = settings.siliflowApiKey;
  (document.getElementById('deepseek-key') as HTMLInputElement).value = settings.deepseekApiKey;
  (document.getElementById('kimi-key') as HTMLInputElement).value = settings.kimiApiKey;
  (document.getElementById('default-comment-count') as HTMLSelectElement).value = String(settings.defaultCommentCount);
  (document.getElementById('default-comment-sort') as HTMLSelectElement).value = settings.defaultCommentSort;
  (document.getElementById('language') as HTMLSelectElement).value = settings.language;

  await loadHistory();
  await loadLogs();
}

async function loadHistory() {
  const { history = [] } = await chrome.storage.local.get('history') as { history?: any[] };
  const container = document.getElementById('history-list')!;
  if (!history.length) {
    container.innerHTML = '<p style="color:#999;font-size:13px">暂无历史记录</p>';
    return;
  }
  container.innerHTML = history.slice(0, 20).map((h: any) => `
    <div class="history-item">
      <span>${escapeHtml(h.title).slice(0, 40)}</span>
      <span style="color:#999;font-size:11px">${new Date(h.timestamp).toLocaleDateString('zh-CN')}</span>
    </div>
  `).join('');
}

async function loadLogs() {
  const result = await chrome.storage.local.get('pipelineLogs') as { pipelineLogs?: StoredLog[] };
  logs = result.pipelineLogs || [];
  renderLogs();
}

function renderLogs() {
  const container = document.getElementById('log-list')!;
  if (!logs.length) {
    container.innerHTML = '<p style="color:#999;font-size:13px">暂无运行日志</p>';
    return;
  }
  container.innerHTML = logs.map((log, i) => `
    <div class="log-item" data-index="${i}">
      <div class="log-item-header">
        <span class="log-item-title">${escapeHtml(log.title).slice(0, 40)}</span>
        <span class="log-item-time">${new Date(log.time).toLocaleString('zh-CN')}</span>
      </div>
      <div class="log-item-preview">${escapeHtml(getFirstLine(log.content))}</div>
      <div class="log-detail" id="log-detail-${i}">${escapeHtml(log.content)}</div>
    </div>
  `).join('');

  // 点击展开/收起日志详情
  container.querySelectorAll('.log-item').forEach(item => {
    item.addEventListener('click', () => {
      item.classList.toggle('selected');
      item.querySelector('.log-detail')!.classList.toggle('open');
    });
  });
}

function getFirstLine(content: string): string {
  const i = content.indexOf('\n');
  return i > -1 ? content.slice(0, i) : content;
}

// ========== 日志导出 ==========

document.getElementById('btn-export-log')?.addEventListener('click', () => {
  const selected = document.querySelectorAll('.log-item.selected');
  if (!selected.length) {
    alert('请先点击选择要导出的日志');
    return;
  }
  const indices = Array.from(selected).map(el => parseInt((el as HTMLElement).dataset.index || '0'));
  const toExport = indices.map(i => logs[i]).filter(Boolean);
  const text = toExport.map(log =>
    `# ${log.title}\n# ${new Date(log.time).toLocaleString('zh-CN')}\n\n${log.content}\n\n---\n`
  ).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  chrome.downloads.download({ url, filename: `pipeline-logs-${Date.now()}.log`, saveAs: true });
});

document.getElementById('btn-clear-logs')?.addEventListener('click', async () => {
  await chrome.storage.local.set({ pipelineLogs: [] });
  logs = [];
  renderLogs();
});

document.getElementById('btn-save')?.addEventListener('click', async () => {
  const siliflowApiKey = (document.getElementById('siliflow-key') as HTMLInputElement).value.trim();
  const deepseekApiKey = (document.getElementById('deepseek-key') as HTMLInputElement).value.trim();
  const kimiApiKey = (document.getElementById('kimi-key') as HTMLInputElement).value.trim();
  const defaultCommentCount = parseInt((document.getElementById('default-comment-count') as HTMLSelectElement).value) as UserSettings['defaultCommentCount'];
  const defaultCommentSort = (document.getElementById('default-comment-sort') as HTMLSelectElement).value as UserSettings['defaultCommentSort'];
  const language = (document.getElementById('language') as HTMLSelectElement).value as UserSettings['language'];

  await saveSettings({ siliflowApiKey, deepseekApiKey, kimiApiKey, defaultCommentCount, defaultCommentSort, language });

  const status = document.getElementById('save-status')!;
  status.textContent = '设置已保存 ✓';
  status.className = 'status-text success';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

document.getElementById('btn-test-siliflow')?.addEventListener('click', async () => {
  const key = (document.getElementById('siliflow-key') as HTMLInputElement).value.trim();
  const status = document.getElementById('siliflow-status')!;
  if (!key) { status.textContent = '请先输入 API Key'; status.className = 'status-text error'; return; }

  status.textContent = '测试中...';
  status.className = 'status-text info';
  try {
    const res = await fetch('https://api.siliconflow.cn/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      status.textContent = '连接成功 ✓';
      status.className = 'status-text success';
    } else {
      status.textContent = `错误: ${res.status}`;
      status.className = 'status-text error';
    }
  } catch {
    status.textContent = '网络错误';
    status.className = 'status-text error';
  }
});

document.getElementById('btn-test-deepseek')?.addEventListener('click', async () => {
  const key = (document.getElementById('deepseek-key') as HTMLInputElement).value.trim();
  const status = document.getElementById('deepseek-status')!;
  if (!key) { status.textContent = '请先输入 API Key'; status.className = 'status-text error'; return; }

  status.textContent = '测试中...';
  status.className = 'status-text info';
  try {
    const res = await fetch('https://api.deepseek.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      status.textContent = '连接成功 ✓';
      status.className = 'status-text success';
    } else {
      status.textContent = `错误: ${res.status}`;
      status.className = 'status-text error';
    }
  } catch {
    status.textContent = '网络错误';
    status.className = 'status-text error';
  }
});

document.getElementById('btn-test-kimi')?.addEventListener('click', async () => {
  const key = (document.getElementById('kimi-key') as HTMLInputElement).value.trim();
  const status = document.getElementById('kimi-status')!;
  if (!key) { status.textContent = '请先输入 API Key'; status.className = 'status-text error'; return; }

  status.textContent = '测试中...';
  status.className = 'status-text info';
  try {
    const res = await fetch('https://api.moonshot.cn/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      status.textContent = '连接成功 ✓';
      status.className = 'status-text success';
    } else {
      status.textContent = `错误: ${res.status}`;
      status.className = 'status-text error';
    }
  } catch {
    status.textContent = '网络错误';
    status.className = 'status-text error';
  }
});

document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
  await chrome.storage.local.set({ history: [] });
  await loadHistory();
});

function escapeHtml(s: string): string {
  const el = document.createElement('div');
  el.textContent = s;
  return el.innerHTML;
}

load();
