import type { AdapterOutput, Comment } from '../lib/types';
import { MSG } from '../lib/messages';

export default defineContentScript({
  matches: ['*://*.xiaohongshu.com/explore/*', '*://*.xiaohongshu.com/discovery/item/*'],
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === MSG.EXTRACT_PAGE_DATA) {
        extractXhsData()
          .then((data) => sendResponse({ data }))
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }
    });
  },
});

async function extractXhsData(): Promise<AdapterOutput> {
  const url = window.location.href;
  let title = '小红书笔记';
  let author = '未知';
  let rawText = '';
  let publishDate: string | undefined;
  let likeCount = 0;
  let favoriteCount = 0;
  const mediaUrls: string[] = [];
  const comments: Comment[] = [];

  // 从页面初始状态提取（参考视频脚本的解析模式）
  try {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.includes('window.__INITIAL_STATE__')) {
        const match = text.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})\s*</s);
        if (match) {
          const state = JSON.parse(match[1].replace(/undefined/g, 'null'));
          const noteId = url.match(/explore\/([a-zA-Z0-9]+)/)?.[1];
          const note = noteId ? state?.note?.noteDetailMap?.[noteId]?.note : null;

          if (note) {
            title = note.title || title;
            author = note.user?.nickname || author;
            rawText = note.desc || '';
            publishDate = note.time ? new Date(note.time).toISOString().split('T')[0] : undefined;
            likeCount = note.interactInfo?.likedCount || 0;
            favoriteCount = note.interactInfo?.collectedCount || 0;

            // 图片 URL
            if (note.imageList) {
              for (const img of note.imageList) {
                const imgUrl = img.urlDefault || img.url || img.infoList?.[0]?.url;
                if (imgUrl) mediaUrls.push(imgUrl);
              }
            }

            // 评论
            const commentList = noteId ? (state?.note?.noteCommentMap?.[noteId]?.comments || []) : [];
            for (const c of commentList.slice(0, 100)) {
              comments.push({
                author: c.userInfo?.nickname || '',
                content: c.content || '',
                likes: c.likeCount || 0,
                time: new Date(c.createTime || 0).toISOString().split('T')[0],
                replies: (c.subComments || []).map((r: any) => ({
                  author: r.userInfo?.nickname || '',
                  content: r.content || '',
                  likes: r.likeCount || 0,
                  time: '',
                })),
              });
            }
          }
          break;
        }
      }
    }
  } catch (e) {
    // 降级到 DOM 提取
  }

  // DOM 降级提取图片
  if (!mediaUrls.length) {
    const imgEls = document.querySelectorAll('.swiper-slide img, .note-image img, .image-container img');
    imgEls.forEach((img) => {
      const src = (img as HTMLImageElement).src;
      if (src && !src.includes('avatar')) mediaUrls.push(src);
    });
  }

  // DOM 降级提取文本
  if (!rawText) {
    const textEl = document.querySelector('.note-text, .desc, .content, [data-v-article]');
    if (textEl) rawText = textEl.textContent?.trim() || '';
  }

  // DOM 降级提取标题和作者
  if (!title || title === '小红书笔记') {
    title = document.querySelector('.title, h1, .note-title')?.textContent?.trim() || document.title.split(' - ')[0] || title;
    const authorEl = document.querySelector('.username, .author-name, .nickname');
    if (authorEl) author = authorEl.textContent?.trim() || author;
  }

  return {
    platform: 'xiaohongshu',
    type: 'note',
    url,
    title,
    author,
    publishDate,
    mediaUrls,
    rawText,
    comments,
    metadata: { likes: likeCount, favorites: favoriteCount },
  };
}
