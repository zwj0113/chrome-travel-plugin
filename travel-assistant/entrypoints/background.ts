import { MSG } from '../lib/messages';
import { runVideoPipeline, runNotePipeline } from '../lib/pipeline';
import type { ExtractConfig, PipelineState } from '../lib/types';

export default defineBackground(() => {
  let currentTabId: number | null = null;
  let cancelled = false;

  // ==================== Offscreen 管理 ====================

  let offscreenReady = false;

  async function ensureOffscreen(): Promise<void> {
    if (offscreenReady) return;
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      });
      if (contexts.length > 0) {
        offscreenReady = true;
        return;
      }
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'Audio processing for video transcription',
      });
      offscreenReady = true;
    } catch (e) {
      // 可能已经存在
      offscreenReady = true;
    }
  }

  // ==================== 消息处理 ====================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 侧边栏 → Background
    if (msg.type === MSG.START_EXTRACTION) {
      handleStartExtraction(msg.tabId, msg.config)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }

    // 取消
    if (msg.type === MSG.CANCEL_EXTRACTION) {
      cancelled = true;
      return false;
    }
  });

  // ==================== 开屏设置页 ====================

  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });

  // ==================== 提取流程 ====================

  async function handleStartExtraction(tabId: number, config: ExtractConfig) {
    cancelled = false;
    currentTabId = tabId;

    // 向内容脚本请求页面数据
    const response: any = await chrome.tabs.sendMessage(tabId, { type: MSG.EXTRACT_PAGE_DATA });

    if (!response?.data) {
      throw new Error(response?.error || '无法提取页面数据');
    }

    const data = response.data;

    // 进度回调 — 转发到侧边栏
    const onProgress = (state: PipelineState) => {
      chrome.runtime.sendMessage({
        type: MSG.PROGRESS_UPDATE,
        state,
      }).catch(() => {}); // 忽略 sidepanel 未连接的情况
    };

    let result: { markdown: string; filename: string };

    if (data.type === 'video') {
      result = await runVideoPipeline(data, config, onProgress);
    } else {
      result = await runNotePipeline(data, config, onProgress);
    }

    // 发送完成结果到侧边栏
    chrome.runtime.sendMessage({
      type: MSG.EXTRACTION_COMPLETE,
      markdown: result.markdown,
      filename: result.filename,
      metadata: {
        platform: data.platform,
        title: data.title,
        url: data.url,
        charCount: result.markdown.length,
        commentCount: data.comments?.length || 0,
      },
    }).catch(() => {});

    return { success: true };
  }
});
