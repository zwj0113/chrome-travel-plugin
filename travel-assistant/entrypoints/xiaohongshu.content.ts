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

  // 从页面初始状态提取（用 brace-counting 解析 JSON，避免正则匹配嵌套括号）
  try {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.includes('window.__INITIAL_STATE__')) {
        const startIdx = text.indexOf('window.__INITIAL_STATE__');
        const braceIdx = text.indexOf('{', text.indexOf('=', startIdx));
        if (braceIdx > 0) {
          // 数括号找匹配的 }
          let depth = 0;
          let endIdx = braceIdx;
          for (let i = braceIdx; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
          }
          const json = text.slice(braceIdx, endIdx + 1);
          const state = JSON.parse(json.replace(/undefined/g, 'null'));
          const noteId = url.match(/explore\/([a-zA-Z0-9]+)/)?.[1];
          const note = noteId ? state?.note?.noteDetailMap?.[noteId]?.note : null;

          if (note) {
            title = note.title || title;
            author = note.user?.nickname || author;
            rawText = note.desc || '';
            publishDate = note.time ? new Date(note.time).toISOString().split('T')[0] : undefined;
            likeCount = note.interactInfo?.likedCount || 0;
            favoriteCount = note.interactInfo?.collectedCount || 0;

            // 图片 — 先收集 DOM 中 CDN 特征图片作为"可见图片"基准
            const domBases = new Set<string>();
            document.querySelectorAll('img').forEach((el) => {
              const src = (el as HTMLImageElement).src;
              if (!src) return;
              if (/avatar|data:image\/svg/i.test(src)) return;
              if (!/xhscdn\.com|sns-webpic/i.test(src)) return;
              domBases.add(src.replace(/[?!].*$/, ''));
            });
            console.log('[旅行助手] DOM可见图片 %d 张', domBases.size);

            // 处理 imageList，用 DOM 基准做过滤（DOM 有数据时以 DOM 为准）
            const seenBases = new Set<string>();
            let dupCount = 0;
            let filteredCount = 0;
            if (note.imageList) {
              for (const img of note.imageList) {
                const imgUrl = img.urlDefault || img.url || img.infoList?.[0]?.url;
                if (!imgUrl) continue;
                const base = imgUrl.replace(/[?!].*$/, '');
                if (seenBases.has(base)) { dupCount++; continue; }
                // 有 DOM 基准时仅保留 DOM 中也存在的图片
                if (domBases.size > 0 && !domBases.has(base)) { filteredCount++; continue; }
                seenBases.add(base);
                try {
                  const dataUrl = await imageUrlToBase64(imgUrl);
                  mediaUrls.push(dataUrl);
                } catch {
                  mediaUrls.push(imgUrl);
                }
              }
            }
            console.log('[旅行助手] imageList=%d, 去重=%d, DOM过滤=%d, 最终=%d',
              note.imageList?.length || 0, dupCount, filteredCount, mediaUrls.length);

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
    console.error('[旅行助手] INITIAL_STATE 解析失败:', e);
  }

  // DOM 降级：INITIAL_STATE 失败时直接从 DOM 提取并转 base64
  if (!mediaUrls.length) {
    const seen = new Set<string>();
    const domImgs = Array.from(document.querySelectorAll('img')).filter((img) => {
      const src = (img as HTMLImageElement).src;
      return src && !/avatar|data:image\/svg/i.test(src) && /xhscdn\.com|sns-webpic/i.test(src);
    });
    for (const img of domImgs) {
      const src = (img as HTMLImageElement).src;
      const base = src.replace(/[?!].*$/, '');
      if (seen.has(base)) continue;
      seen.add(base);
      try {
        const dataUrl = await imageUrlToBase64(src);
        mediaUrls.push(dataUrl);
      } catch {
        mediaUrls.push(src);
      }
    }
    console.log('[旅行助手] DOM降级: %d 张图片', mediaUrls.length);
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
