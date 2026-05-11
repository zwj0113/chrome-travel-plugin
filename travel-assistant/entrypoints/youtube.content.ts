import type { AdapterOutput, Comment } from '../lib/types';
import { MSG } from '../lib/messages';

export default defineContentScript({
  matches: ['*://*.youtube.com/watch*'],
  main() {
    // 只在顶层 frame 响应，避免 iframe 中的内容脚本返回不完整数据
    if (window.self !== window.top) return;

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === MSG.EXTRACT_PAGE_DATA) {
        extractYoutubeData()
          .then((data) => sendResponse({ data }))
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }
    });
  },
});

async function extractYoutubeData(): Promise<AdapterOutput> {
  const url = window.location.href;

  // 从页面 ytInitialData 提取
  const ytInitialData = (window as any).ytInitialData || (window as any).ytplayer?.config?.args?.player_response;
  let title = document.title.replace(' - YouTube', '').trim();
  let author = '';
  let publishDate: string | undefined;
  let description = '';
  let viewCount = 0;
  let likeCount = 0;

  // 从 ytInitialPlayerResponse 获取
  const playerResponse = (window as any).ytInitialPlayerResponse;
  if (playerResponse?.videoDetails) {
    const vd = playerResponse.videoDetails;
    title = vd.title || title;
    author = vd.author || '';
    viewCount = parseInt(vd.viewCount) || 0;
    description = vd.shortDescription || '';
  }

  // 从页面 meta 获取日期
  const dateEl = document.querySelector('meta[itemprop="datePublished"]');
  if (dateEl) {
    publishDate = dateEl.getAttribute('content')?.split('T')[0];
  }

  // 获取视频 URL — 自适应格式
  const mediaUrls: string[] = [];
  try {
    const formats = playerResponse?.streamingData?.adaptiveFormats || [];
    const audioFormat = formats.find((f: any) => f.mimeType?.startsWith('audio/'));
    if (audioFormat?.url) {
      mediaUrls.push(audioFormat.url);
    }
    const videoFormat = formats.find((f: any) => f.mimeType?.startsWith('video/'));
    if (videoFormat?.url) {
      mediaUrls.push(videoFormat.url);
    }
  } catch {}

  // 提取评论 — 从 DOM
  const comments: Comment[] = [];
  const commentEls = document.querySelectorAll('ytd-comment-thread-renderer');
  commentEls.forEach((el, i) => {
    if (i >= 100) return;
    const authorEl = el.querySelector('#author-text span');
    const contentEl = el.querySelector('#content-text');
    const likesEl = el.querySelector('#vote-count-middle');
    if (authorEl?.textContent && contentEl?.textContent) {
      comments.push({
        author: authorEl.textContent.trim(),
        content: contentEl.textContent.trim(),
        likes: parseInt(likesEl?.textContent?.trim() || '0') || 0,
        time: '',
      });
    }
  });

  return {
    platform: 'youtube',
    type: 'video',
    url,
    title,
    author,
    publishDate,
    description,
    mediaUrls,
    comments,
    metadata: { views: viewCount, likes: likeCount },
  };
}
