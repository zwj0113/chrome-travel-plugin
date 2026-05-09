import type { AdapterOutput, Comment } from '../lib/types';
import { MSG } from '../lib/messages';

export default defineContentScript({
  matches: ['*://*.douyin.com/*', '*://*.iesdouyin.com/*'],
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === MSG.EXTRACT_PAGE_DATA) {
        extractDouyinData()
          .then((data) => sendResponse({ data }))
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }
    });
  },
});

async function extractDouyinData(): Promise<AdapterOutput> {
  const url = window.location.href;
  let title = '抖音视频';
  let author = '未知';
  let description = '';
  const mediaUrls: string[] = [];
  const comments: Comment[] = [];

  // 从页面全局变量提取（抖音页面结构多变，尝试多种路径）
  try {
    const routerData = (window as any)._ROUTER_DATA || (window as any).__NEXT_DATA__;
    const pageData = routerData?.loaderData || routerData?.props?.pageProps;
    const videoData = pageData?.['video_(id)'] || pageData?.videoInfo || pageData?.itemList?.[0];

    if (videoData) {
      const video = videoData.video || videoData;
      title = video.desc || video.title || title;
      author = video.author?.nickname || video.authorName || author;
      description = video.desc || '';

      // 获取无水印视频 URL
      if (video.playAddr || video.video?.playAddr) {
        const addr = (video.playAddr || video.video.playAddr);
        const urls = Array.isArray(addr) ? addr : [addr];
        for (const u of urls) {
          let videoUrl = u.url_list?.[0] || u.urlList?.[0] || u;
          // 替换水印域名
          videoUrl = videoUrl.replace('playwm', 'play');
          mediaUrls.push(videoUrl);
        }
      }
    }

    // 提取评论
    const commentList = pageData?.commentList || pageData?.comments || [];
    for (const c of (Array.isArray(commentList) ? commentList : []).slice(0, 100)) {
      comments.push({
        author: c.user?.nickname || c.userName || '',
        content: c.text || c.content || '',
        likes: c.digg_count || c.likeCount || 0,
        time: new Date((c.create_time || c.createTime || 0) * 1000).toISOString().split('T')[0],
      });
    }
  } catch (e) {
    // DOM 提取降级
    const videoEl = document.querySelector('video');
    if (videoEl?.src) mediaUrls.push(videoEl.src);
  }

  // 从页面元素提取
  if (!title || title === '抖音视频') {
    const titleEl = document.querySelector('[data-e2e="video-desc"], .video-title, h1');
    if (titleEl) title = titleEl.textContent?.trim() || title;
  }

  const likeCount = parseInt(document.querySelector('[data-e2e="like-count"]')?.textContent || '0') || 0;
  const commentCount = parseInt(document.querySelector('[data-e2e="comment-count"]')?.textContent || '0') || 0;

  return {
    platform: 'douyin',
    type: 'video',
    url,
    title,
    author,
    description,
    mediaUrls,
    comments,
    metadata: { likes: likeCount, commentCount },
  };
}
