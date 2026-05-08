import type { AdapterOutput, Comment } from '../lib/types';
import { MSG } from '../lib/messages';
import type { PageDataExtractedPayload, StartExtractionPayload, ExtractionCompletePayload, ProgressUpdatePayload } from '../lib/messages';

export default defineContentScript({
  matches: ['*://*.bilibili.com/video/*'],
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === MSG.EXTRACT_PAGE_DATA) {
        extractBilibiliData()
          .then((data) => sendResponse({ data }))
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }
    });
  },
});

async function extractBilibiliData(): Promise<AdapterOutput> {
  const url = window.location.href;
  const bvid = url.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1] || '';

  // 从页面脚本变量提取视频信息
  const initialState = (window as any).__INITIAL_STATE__;
  const videoData = initialState?.videoData;

  const title = videoData?.title || document.title.replace('_哔哩哔哩_bilibili', '').trim();
  const author = videoData?.owner?.name || '未知';
  const publishDate = videoData?.pubdate
    ? new Date(videoData.pubdate * 1000).toISOString().split('T')[0]
    : undefined;
  const description = videoData?.desc || '';

  // 通过 B站 API 获取播放地址
  const mediaUrls: string[] = [];
  if (bvid) {
    try {
      const cid = videoData?.pages?.[0]?.cid || videoData?.cid;
      if (cid) {
        const apiUrl = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16&fourk=1`;
        const resp = await fetch(apiUrl);
        const json = await resp.json();
        const dash = json?.data?.dash;
        if (dash?.video?.length) {
          mediaUrls.push(dash.video[0].baseUrl || dash.video[0].base_url);
        }
        if (dash?.audio?.length) {
          mediaUrls.push(dash.audio[0].baseUrl || dash.audio[0].base_url);
        }
      }
    } catch (e) {
      // 降级：尝试从 video 标签获取 src
      const videoEl = document.querySelector('video');
      if (videoEl?.src) mediaUrls.push(videoEl.src);
    }
  }

  // 提取评论（从页面数据）
  const comments: Comment[] = [];
  try {
    const pagelist = initialState?.videoData?.pages;
    const aid = videoData?.aid;
    if (aid) {
      const commentUrl = `https://api.bilibili.com/x/v2/reply/main?oid=${aid}&type=1&mode=3`;
      const resp = await fetch(commentUrl);
      const json = await resp.json();
      const replies = json?.data?.replies || [];
      for (const r of replies.slice(0, 100)) {
        comments.push({
          author: r.member?.uname || '未知',
          content: r.content?.message || '',
          likes: r.like || 0,
          time: new Date((r.ctime || 0) * 1000).toISOString().split('T')[0],
          replies: (r.replies || []).map((rr: any) => ({
            author: rr.member?.uname || '',
            content: rr.content?.message || '',
            likes: rr.like || 0,
            time: '',
          })),
        });
      }
    }
  } catch (e) {
    // 评论获取失败不阻塞主流程
  }

  const metadata: Record<string, unknown> = {};
  const stat = videoData?.stat;
  if (stat) {
    if (stat.view) metadata.views = stat.view;
    if (stat.like) metadata.likes = stat.like;
    if (stat.favorite) metadata.favorites = stat.favorite;
  }

  return {
    platform: 'bilibili',
    type: 'video',
    url,
    title,
    author,
    publishDate,
    description,
    mediaUrls,
    comments,
    metadata,
  };
}
