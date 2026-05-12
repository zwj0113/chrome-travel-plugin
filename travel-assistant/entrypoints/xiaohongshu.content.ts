import type { AdapterOutput, Comment } from '../lib/types';
import { MSG } from '../lib/messages';

export default defineContentScript({
  matches: ['*://*.xiaohongshu.com/explore/*', '*://*.xiaohongshu.com/discovery/item/*'],
  main() {
    // 只在顶层 frame 响应，避免 iframe 中的内容脚本返回不完整数据
    if (window.self !== window.top) return;

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

async function imageUrlToBase64(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`下载图片失败 ${resp.status}`);
  const blob = await resp.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // 分块转换，避免大图片导致 "Maximum call stack size exceeded"
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  }
  const base64 = btoa(binary);
  return `data:${blob.type || 'image/jpeg'};base64,${base64}`;
}

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

            // 图片 URL — 就地下载转 base64，避免 background 无 cookie 导致防盗链
            // 同时按 base URL 去重：小红书同一图片会产生多个不同尺寸 URL
            const seenBases = new Set<string>();
            // 先收集 DOM 中可见图片的 base URL，用于交叉验证
            const domBases = new Set<string>();
            document.querySelectorAll('.swiper-slide img, .note-image img, .image-container img, [class*="slide"] img').forEach((el) => {
              const src = (el as HTMLImageElement).src;
              if (src && !src.includes('avatar')) domBases.add(src.replace(/[?!].*$/, ''));
            });
            if (note.imageList) {
              for (const img of note.imageList) {
                const imgUrl = img.urlDefault || img.url || img.infoList?.[0]?.url;
                if (!imgUrl) continue;
                const base = imgUrl.replace(/[?!].*$/, '');
                if (seenBases.has(base)) continue;
                // 有 DOM 参照时，仅保留 DOM 中也存在的图片
                if (domBases.size > 0 && !domBases.has(base)) continue;
                seenBases.add(base);
                try {
                  const dataUrl = await imageUrlToBase64(imgUrl);
                  mediaUrls.push(dataUrl);
                } catch {
                  // 转 base64 失败则保留原始 URL
                  mediaUrls.push(imgUrl);
                }
              }
            }
            // 无 imageList 时从 DOM 降级
            if (!mediaUrls.length && domBases.size > 0) {
              for (const imgEl of document.querySelectorAll('.swiper-slide img, .note-image img, .image-container img, [class*="slide"] img')) {
                const src = (imgEl as HTMLImageElement).src;
                if (src && !src.includes('avatar')) mediaUrls.push(src);
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
