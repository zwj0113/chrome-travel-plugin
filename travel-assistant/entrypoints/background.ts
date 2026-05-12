import { MSG } from '../lib/messages';
import { runVideoPipeline, runNotePipeline } from '../lib/pipeline';
import type { ExtractConfig, PipelineState } from '../lib/types';

export default defineBackground(() => {
  let cancelled = false;

  // ==================== 设置请求头注入 ====================

  setupHeaderRules();

  async function setupHeaderRules() {
    // 先清掉旧规则，避免 Service Worker 重启后 ID 冲突
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    if (existing.length > 0) {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: existing.map((r) => r.id),
      });
    }

    // 为 B站 CDN 请求自动注入 Referer
    const bilibiliCdnDomains = ['bilivideo.com', 'hdslb.com'];
    const rules: chrome.declarativeNetRequest.Rule[] = bilibiliCdnDomains.map((domain, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [{
          header: 'Referer',
          operation: chrome.declarativeNetRequest.HeaderOperation.SET,
          value: 'https://www.bilibili.com/',
        }],
      },
      condition: {
        urlFilter: `*${domain}/*`,
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST],
      },
    }));

    // 为抖音 CDN 请求注入 Referer
    const douyinRule: chrome.declarativeNetRequest.Rule = {
      id: rules.length + 1,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [{
          header: 'Referer',
          operation: chrome.declarativeNetRequest.HeaderOperation.SET,
          value: 'https://www.douyin.com/',
        }],
      },
      condition: {
        urlFilter: '*douyinvod.com/*',
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST],
      },
    };

    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [...rules, douyinRule],
    });
  }

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
      offscreenReady = true;
    }
  }

  // ==================== 消息处理 ====================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === MSG.START_EXTRACTION) {
      handleStartExtraction(msg.tabId, msg.config)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }

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

    const response: any = await chrome.tabs.sendMessage(tabId, { type: MSG.EXTRACT_PAGE_DATA, config: { commentSort: config.commentSort, commentCount: config.commentCount } }, { frameId: 0 });

    if (!response?.data) {
      throw new Error(response?.error || '无法提取页面数据');
    }

    const data = response.data;

    const onProgress = (state: PipelineState) => {
      chrome.runtime.sendMessage({
        type: MSG.PROGRESS_UPDATE,
        state,
      }).catch(() => {});
    };

    let result: { markdown: string; filename: string; log: string };

    if (data.type === 'video') {
      result = await runVideoPipeline(data, config, onProgress);
    } else {
      result = await runNotePipeline(data, config, onProgress);
    }

    chrome.runtime.sendMessage({
      type: MSG.EXTRACTION_COMPLETE,
      markdown: result.markdown,
      filename: result.filename,
      log: result.log,
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
