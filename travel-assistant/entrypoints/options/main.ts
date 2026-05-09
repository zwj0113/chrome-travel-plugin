import { loadSettings, saveSettings } from '../../lib/config-manager';
import type { UserSettings } from '../../lib/types';

let settings: UserSettings;

async function load() {
  settings = await loadSettings();

  (document.getElementById('siliflow-key') as HTMLInputElement).value = settings.siliflowApiKey;
  (document.getElementById('deepseek-key') as HTMLInputElement).value = settings.deepseekApiKey;
  (document.getElementById('default-comment-count') as HTMLSelectElement).value = String(settings.defaultCommentCount);
  (document.getElementById('default-comment-sort') as HTMLSelectElement).value = settings.defaultCommentSort;
  (document.getElementById('language') as HTMLSelectElement).value = settings.language;

  await loadHistory();
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

document.getElementById('btn-save')?.addEventListener('click', async () => {
  const siliflowApiKey = (document.getElementById('siliflow-key') as HTMLInputElement).value.trim();
  const deepseekApiKey = (document.getElementById('deepseek-key') as HTMLInputElement).value.trim();
  const defaultCommentCount = parseInt((document.getElementById('default-comment-count') as HTMLSelectElement).value) as UserSettings['defaultCommentCount'];
  const defaultCommentSort = (document.getElementById('default-comment-sort') as HTMLSelectElement).value as UserSettings['defaultCommentSort'];
  const language = (document.getElementById('language') as HTMLSelectElement).value as UserSettings['language'];

  await saveSettings({ siliflowApiKey, deepseekApiKey, defaultCommentCount, defaultCommentSort, language });

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
