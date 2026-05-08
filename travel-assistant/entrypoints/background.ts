import { MSG } from '../lib/messages';

export default defineBackground(() => {
  let offscreenDocument: string | null = null;

  async function ensureOffscreen(): Promise<void> {
    if (offscreenDocument) return;
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (contexts.length > 0) {
      offscreenDocument = 'active';
      return;
    }
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Audio processing for video transcription',
    });
    offscreenDocument = 'active';
  }

  // 处理来自侧边栏的提取请求
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === MSG.START_EXTRACTION) {
      handleStartExtraction(msg.tabId, msg.config)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }
  });

  async function handleStartExtraction(tabId: number, config: any) {
    // 向内容脚本发送提取请求
    const response = await chrome.tabs.sendMessage(tabId, { type: MSG.EXTRACT_PAGE_DATA });
    if (response.error) throw new Error(response.error);
    return response;
  }
});
