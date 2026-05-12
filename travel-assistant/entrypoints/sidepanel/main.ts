import { MSG } from '../../lib/messages';
import type { ExtractConfig, PipelineState, HistoryEntry } from '../../lib/types';

const app = document.getElementById('app')!;
let isExtracting = false;

// ========== 渲染函数 ==========

function renderIdleState(history: HistoryEntry[]): string {
  return `
    <div class="brand">
      <div class="brand-icon">🗺️</div>
      <div class="brand-title">旅游攻略助手</div>
      <div class="brand-subtitle">在视频或图文页面点击下方按钮开始</div>
    </div>

    <div id="toast-container"></div>

    <button id="btn-start" class="btn btn-primary">🎬 一键提取当前页面</button>

    ${history.length ? `
    <div class="history-section">
      <div class="history-title">最近记录</div>
      ${history.slice(0, 5).map(h => `
        <div class="history-item">
          <div class="history-item-title">${escapeHtml(h.title)}</div>
          <div class="history-item-meta">${h.platform} - ${new Date(h.timestamp).toLocaleString('zh-CN')}</div>
        </div>
      `).join('')}
    </div>
    ` : ''}

    <div id="config-modal" class="hidden">
      <div class="modal-overlay">
        <div class="modal">
          <div class="modal-title">提取配置</div>
          <div class="form-group">
            <label class="form-label">评论数量</label>
            <select id="cfg-comments" class="form-select">
              <option value="20">热门前 20 条</option>
              <option value="50" selected>热门前 50 条</option>
              <option value="100">热门前 100 条</option>
              <option value="0">全部评论</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">评论排序</label>
            <select id="cfg-sort" class="form-select">
              <option value="hot" selected>按热度</option>
              <option value="time">按时间</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">视频处理</label>
            <div class="form-radio-group">
              <label><input type="radio" name="download" value="false" checked> 仅转录</label>
              <label><input type="radio" name="download" value="true"> 下载+转录</label>
            </div>
          </div>
          <div class="modal-actions">
            <button id="btn-cancel-config" class="btn btn-outline">取消</button>
            <button id="btn-confirm-config" class="btn btn-primary">开始提取</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderProcessingState(title: string, state: PipelineState): string {
  const stepsHtml = state.steps.map(s => {
    let icon = '○';
    let cls = '';
    if (s.status === 'done') { icon = '✓'; cls = 'done'; }
    else if (s.status === 'running') { icon = '⟳'; cls = 'active'; }
    else if (s.status === 'error') { icon = '✗'; cls = 'error'; }
    return `
      <li class="progress-item ${cls}">
        <span class="progress-icon">${icon}</span>
        <span class="progress-label">${s.label}</span>
        ${s.detail ? `<span class="progress-detail">${s.detail}</span>` : ''}
      </li>
    `;
  }).join('');

  return `
    <div class="progress-section">
      <div class="progress-header">${escapeHtml(title)}</div>
      <ul class="progress-list">${stepsHtml}</ul>
      <button id="btn-cancel" class="btn btn-outline" style="margin-top:16px">取消</button>
    </div>
  `;
}

function renderCompleteState(title: string, platform: string, charCount: number, commentCount: number, markdown: string): string {
  return `
    <div class="preview-section">
      <div class="preview-info">
        <span>${escapeHtml(platform)}</span>
        <span>·</span>
        <span>${charCount}字</span>
        <span>·</span>
        <span>${commentCount}条评论</span>
      </div>
      <div class="preview-content">${escapeHtml(markdown).slice(0, 2000)}${markdown.length > 2000 ? '\n\n... (预览截断，完整内容请下载)' : ''}</div>
      <div class="action-bar">
        <button id="btn-download" class="btn btn-primary">⬇ 下载 Markdown</button>
      </div>
      <button id="btn-copy" class="btn btn-outline" style="margin-top:8px; width:100%">📋 复制到剪贴板</button>
    </div>
  `;
}

function escapeHtml(s: string): string {
  const el = document.createElement('div');
  el.textContent = s;
  return el.innerHTML;
}

// ========== 事件处理 ==========

function bindIdleEvents() {
  document.getElementById('btn-start')?.addEventListener('click', () => {
    document.getElementById('config-modal')!.classList.remove('hidden');
  });

  document.getElementById('btn-cancel-config')?.addEventListener('click', () => {
    document.getElementById('config-modal')!.classList.add('hidden');
  });

  document.getElementById('btn-confirm-config')?.addEventListener('click', () => {
    document.getElementById('config-modal')!.classList.add('hidden');
    startExtraction();
  });
}

function getConfig(): ExtractConfig {
  const commentCount = parseInt((document.getElementById('cfg-comments') as HTMLSelectElement).value) as ExtractConfig['commentCount'];
  const commentSort = (document.getElementById('cfg-sort') as HTMLSelectElement).value as ExtractConfig['commentSort'];
  const downloadVideo = (document.querySelector('input[name="download"]:checked') as HTMLInputElement)?.value === 'true';
  return { commentCount, commentSort, downloadVideo };
}

async function startExtraction() {
  if (isExtracting) return;
  isExtracting = true;

  const config = getConfig();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    // 请求内容脚本提取数据
    const response = await chrome.tabs.sendMessage(tab.id, { type: MSG.EXTRACT_PAGE_DATA, config: { commentSort: config.commentSort, commentCount: config.commentCount } }, { frameId: 0 });
    if (!response?.data) throw new Error('无法提取页面数据');

    // 请求 background 执行流水线
    chrome.runtime.sendMessage({
      type: MSG.START_EXTRACTION,
      tabId: tab.id,
      config,
    });
  } catch (e) {
    isExtracting = false;
    showToast(`提取失败: ${(e as Error).message}`, true);
  }
}

function showToast(message: string, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  container.innerHTML = `<div class="toast" style="background:${isError ? 'var(--error)' : 'var(--warning)'}">${message}</div>`;
  setTimeout(() => { container.innerHTML = ''; }, 4000);
}

// ========== 消息监听 ==========

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.PROGRESS_UPDATE) {
    const state = msg.state as PipelineState;
    app.innerHTML = renderProcessingState('处理中...', state);
    bindProcessingEvents();
  }
  if (msg.type === MSG.EXTRACTION_COMPLETE) {
    isExtracting = false;
    const { markdown, metadata, log } = msg;
    app.innerHTML = renderCompleteState(metadata?.title || '', metadata?.platform || '', markdown.length, metadata?.commentCount || 0, markdown);
    bindCompleteEvents(markdown, msg.filename);
    // 保存历史
    saveHistory(metadata);
    // 运行日志写入后台存储（供排查使用）
    if (log) saveLog(metadata?.title || '', log);
  }
});

function bindProcessingEvents() {
  document.getElementById('btn-cancel')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: MSG.CANCEL_EXTRACTION });
    isExtracting = false;
    loadIdleState();
  });
}

let _lastMarkdown = '';
let _lastFilename = '';

function bindCompleteEvents(markdown: string, filename: string) {
  _lastMarkdown = markdown;
  _lastFilename = filename;

  document.getElementById('btn-download')?.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    chrome.downloads.download({ url, filename, saveAs: true });
  });

  document.getElementById('btn-copy')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(markdown);
    showToast('已复制到剪贴板');
  });
}

interface StoredLog { title: string; content: string; time: number; }

async function saveLog(title: string, content: string) {
  const { pipelineLogs = [] } = await chrome.storage.local.get('pipelineLogs') as { pipelineLogs?: StoredLog[] };
  pipelineLogs.unshift({ title, content, time: Date.now() });
  await chrome.storage.local.set({ pipelineLogs: pipelineLogs.slice(0, 10) });
}

async function saveHistory(metadata: any) {
  const { history = [] } = await chrome.storage.local.get('history') as { history?: HistoryEntry[] };
  const entry: HistoryEntry = {
    id: Date.now().toString(),
    platform: metadata?.platform || 'unknown',
    title: metadata?.title || 'Untitled',
    url: metadata?.url || '',
    timestamp: Date.now(),
    charCount: metadata?.charCount || 0,
  };
  history.unshift(entry);
  await chrome.storage.local.set({ history: history.slice(0, 50) });
}

async function loadIdleState() {
  const { history = [] } = await chrome.storage.local.get('history') as { history?: HistoryEntry[] };
  app.innerHTML = renderIdleState(history);
  bindIdleEvents();

  // 检查 API Key
  const { settings } = await chrome.storage.local.get('settings') as { settings?: { siliflowApiKey?: string; deepseekApiKey?: string; kimiApiKey?: string } };
  if (!settings?.deepseekApiKey && !settings?.siliflowApiKey && !settings?.kimiApiKey) {
    showToast('⚠️ 请先配置 API Key（<a href="#" id="go-options">前往设置</a>）');
    document.getElementById('go-options')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

// ========== 初始化 ==========
loadIdleState();
