import type { AdapterOutput, Comment } from '../lib/types';
import { MSG } from '../lib/messages';

export default defineContentScript({
  matches: ['*://*.xiaohongshu.com/explore/*', '*://*.xiaohongshu.com/discovery/item/*'],
  main() {
    // 只在顶层 frame 响应，避免 iframe 中的内容脚本返回不完整数据
    if (window.self !== window.top) return;

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === MSG.EXTRACT_PAGE_DATA) {
        const cfg = msg.config || {};
        extractXhsData(cfg.enableImageRecognition)
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

/**
 * 等待并提取评论（含嵌套回复）。
 * 小红书嵌套回复是按需加载的——需要先点击"展开回复"按钮。
 * 策略：等待初始评论出现 → 自动展开所有嵌套回复 → DOM 提取。
 */
async function waitForComments(timeoutMs = 18000): Promise<Comment[]> {
  const CHECK_INTERVAL = 300;
  const maxTries = Math.ceil(timeoutMs / CHECK_INTERVAL);

  // 第一阶段：等待初始评论出现
  for (let i = 0; i < maxTries; i++) {
    const els = document.querySelectorAll('[class*="comment-item"], [class*="commentItem"], [class*="CommentItem"]');
    if (els.length > 0) {
      console.log(`XHS comments appeared after ${i * CHECK_INTERVAL}ms, ${els.length} items, expanding replies...`);
      // 第二阶段：自动展开所有嵌套回复
      await expandAllReplies();
      // 第三阶段：从 DOM 提取
      const comments = extractCommentsFromDOM();
      console.log(`XHS comments extracted: ${comments.length} top-level`);
      return comments;
    }
    await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
  }

  console.log(`XHS comment wait timed out after ${timeoutMs}ms`);
  return [];
}

/**
 * 自动点击所有"展开回复"按钮，加载嵌套回复。
 */
async function expandAllReplies(): Promise<void> {
  const maxRounds = 5;
  for (let round = 0; round < maxRounds; round++) {
    // 查找所有可能的"展开"按钮
    const expandButtons = document.querySelectorAll(
      '[class*="show-more"], [class*="expand"], [class*="load-more"], ' +
      '[class*="more-reply"], [class*="sub-comment"], [class*="view-all"], ' +
      'span, a, div'
    );

    const toClick: Element[] = [];
    for (const btn of expandButtons) {
      const text = btn.textContent?.trim() || '';
      // 匹配"展开回复"、"展开更多"、"查看全部"等
      if (/^(展开|查看|显示).*(回复|更多|全部|评论)/.test(text) ||
          /^共?\d+条回复/.test(text) ||
          /^(更多|全部)回复/.test(text)) {
        toClick.push(btn);
      }
    }

    if (!toClick.length) {
      console.log(`[XHS DEBUG] No expand buttons found in round ${round}, done`);
      break;
    }

    console.log(`[XHS DEBUG] Round ${round}: clicking ${toClick.length} expand buttons:`, toClick.map(b => b.textContent?.trim()?.slice(0, 30)));
    for (const btn of toClick) {
      try { (btn as HTMLElement).click(); } catch {}
    }

    // 等待加载
    await new Promise((r) => setTimeout(r, 2000));

    // 诊断：检查 DOM 结构变化
    if (round === 0) {
      const items = document.querySelectorAll('[class*="comment-item"], [class*="commentItem"]');
      console.log(`[XHS DEBUG] After expansion: ${items.length} comment items`);
      // 检查前几条的父元素
      for (let i = 0; i < Math.min(3, items.length); i++) {
        const item = items[i];
        const parent = item.parentElement;
        console.log(`[XHS DEBUG]   item[${i}] parent class: "${parent?.className?.toString?.()?.slice(0, 60) || parent?.tagName}"`);
        // 检查是否有兄弟 comment-item 在同一个父元素下
        const siblings = parent ? Array.from(parent.children).filter(c => c.matches('[class*="comment-item"], [class*="commentItem"]')) : [];
        console.log(`[XHS DEBUG]   item[${i}] sibling comment-items under same parent: ${siblings.length}`);
      }
    }
  }
}

/**
 * 从 DOM 提取评论（含嵌套结构）。
 * 策略：
 *   1. 收集所有 comment-item，按直接父元素分组 → parentGroups
 *   2. 构建容器之间的父子关系 → containerTree（parentGroups 的 key 之间的包含关系）
 *   3. 找到根容器（不被任何其他容器包含的容器），从根开始递归构建
 *   4. parent-comment 容器：第一个 comment-item 是父评论，其余是回复
 *      list-container 容器：所有 comment-item 是平级顶层
 */
function extractCommentsFromDOM(): Comment[] {
  const allItems = Array.from(document.querySelectorAll(
    '[class*="comment-item"], [class*="commentItem"], [class*="CommentItem"]'
  )).filter(el => !el.querySelector('textarea, input[type="text"]'));

  if (!allItems.length) return [];

  console.log(`[XHS DEBUG] Total comment items for extraction: ${allItems.length}`);

  // 步骤 1：按直接父元素分组
  const parentGroups = new Map<Element, Element[]>();
  for (const item of allItems) {
    const parent = item.parentElement;
    if (!parent) continue;
    if (!parentGroups.has(parent)) parentGroups.set(parent, []);
    parentGroups.get(parent)!.push(item);
  }

  console.log(`[XHS DEBUG] Parent groups: ${parentGroups.size} unique parents`);
  for (const [parent, items] of parentGroups) {
    const pClass = parent.className?.toString?.()?.slice(0, 60) || parent.tagName;
    console.log(`[XHS DEBUG]   "${pClass}": ${items.length} comment-items`);
  }

  // 步骤 2：构建容器之间的父子关系
  // 对每个容器，向上遍历 DOM 找到最近的也在 parentGroups 中的祖先
  const containers = Array.from(parentGroups.keys());
  const containerParent = new Map<Element, Element | null>();
  for (const container of containers) {
    let parent = container.parentElement;
    let found: Element | null = null;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      if (parentGroups.has(parent)) {
        found = parent;
        break;
      }
      parent = parent.parentElement;
    }
    containerParent.set(container, found);
  }

  // 步骤 3：找到根容器（没有容器父元素的）
  const roots = containers.filter(c => !containerParent.get(c));
  console.log(`[XHS DEBUG] Root containers: ${roots.length}`);
  for (const root of roots) {
    const cls = root.className?.toString?.()?.slice(0, 60) || root.tagName;
    console.log(`[XHS DEBUG]   root: "${cls}" with ${parentGroups.get(root)?.length || 0} items`);
  }

  // 步骤 4：从每个根容器递归构建评论树
  if (!roots.length) return [];

  const allComments = roots.flatMap(root =>
    buildCommentTree(root, parentGroups, containerParent)
  );

  // 统计嵌套
  function countNested(comments: Comment[]): number {
    let n = 0;
    for (const c of comments) {
      if (c.replies) n += c.replies.length + countNested(c.replies);
    }
    return n;
  }
  console.log(`[XHS DEBUG] Tree built: ${allComments.length} top-level, ${countNested(allComments)} nested`);

  return allComments;
}

/**
 * 从容器元素递归构建评论树。
 * parent-comment：第一个 comment-item 是父评论，其余是直接回复
 * list-container 等其他容器：所有 comment-item 平级，子容器递归
 */
function buildCommentTree(
  container: Element,
  parentGroups: Map<Element, Element[]>,
  containerParent: Map<Element, Element | null>,
): Comment[] {
  const comments: Comment[] = [];
  const topItems = parentGroups.get(container) || [];

  // 找到这个容器的直接子容器
  const childContainers: Element[] = [];
  for (const [child, parent] of containerParent) {
    if (parent === container) childContainers.push(child);
  }

  const isParentComment = container.matches('[class*="parent-comment"], [class*="parentComment"]');

  if (isParentComment) {
    // parent-comment：第一个是父评论，其余都是回复
    if (!topItems.length) {
      // 容器为空，但仍可能有子容器
      return childContainers.flatMap(c => buildCommentTree(c, parentGroups, containerParent));
    }
    const parent = extractSingleComment(topItems[0]);
    if (!parent) return [];
    const replies: Comment[] = [];
    for (let i = 1; i < topItems.length; i++) {
      const reply = extractSingleComment(topItems[i]);
      if (reply) replies.push(reply);
    }
    // 子容器的内容也作为回复
    for (const child of childContainers) {
      replies.push(...buildCommentTree(child, parentGroups, containerParent));
    }
    if (replies.length) parent.replies = replies;
    return [parent];
  }

  // 普通容器（list-container 等）：子容器 + 直接 comment-item 都是平级顶层
  for (const child of childContainers) {
    comments.push(...buildCommentTree(child, parentGroups, containerParent));
  }
  for (const item of topItems) {
    const c = extractSingleComment(item);
    if (c) comments.push(c);
  }
  return comments;
}

/**
 * 从单个 DOM 元素提取评论内容。
 */
function extractSingleComment(el: Element): Comment | null {
  // 查找作者
  const authorEl = el.querySelector('[class*="name"], [class*="nickname"], [class*="author"], [class*="user"]');
  const author = authorEl?.textContent?.trim() || '';

  // 查找内容
  const contentEl = el.querySelector('[class*="content"], [class*="desc"], [class*="text"], [class*="body"]');
  const content = contentEl?.textContent?.trim() || '';

  if (!content) return null;

  // 查找时间和点赞
  const timeEl = el.querySelector('[class*="time"], [class*="date"]');
  const time = timeEl?.textContent?.trim() || '';
  const likesEl = el.querySelector('[class*="like"] span, [class*="like"]');
  const likes = parseInt(likesEl?.textContent?.trim() || '0', 10) || 0;

  return { author, content, likes, time };
}

/**
 * 从扁平评论列表（带层级）构建嵌套树。
 */
function buildTreeFromFlat(flat: (Comment & { _level: number })[]): Comment[] {
  const roots: Comment[] = [];
  const stack: { node: Comment; level: number }[] = [];

  for (const item of flat) {
    const { _level, ...comment } = item;
    // 弹出栈中层级 >= 当前层级的节点
    while (stack.length && stack[stack.length - 1].level >= _level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // 顶层评论
      roots.push(comment);
      stack.push({ node: comment, level: _level });
    } else {
      // 作为父评论的子评论
      const parent = stack[stack.length - 1].node;
      if (!parent.replies) parent.replies = [];
      parent.replies.push(comment);
      stack.push({ node: comment, level: _level });
    }
  }

  return roots;
}

async function extractXhsData(enableImageRecognition = true): Promise<AdapterOutput> {
  const url = window.location.href;

  let title = '小红书笔记';
  let author = '未知';
  let rawText = '';
  let publishDate: string | undefined;
  let likeCount = 0;
  let favoriteCount = 0;
  const mediaUrls: string[] = [];
  let comments: Comment[] = [];

  // 从 <script> 中的 SSR 快照提取笔记元数据（标题/作者/正文/图片）
  // 注意：评论是异步加载的，通过 DOM 提取
  let noteId: string | undefined;
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
          noteId = url.match(/explore\/([a-zA-Z0-9]+)/)?.[1]
            || url.match(/discovery\/item\/([a-zA-Z0-9]+)/)?.[1];
          const note = noteId ? state?.note?.noteDetailMap?.[noteId]?.note : null;

          if (note) {
            title = note.title || title;
            author = note.user?.nickname || author;
            rawText = note.desc || '';
            publishDate = note.time ? new Date(note.time).toISOString().split('T')[0] : undefined;
            likeCount = note.interactInfo?.likedCount || 0;
            favoriteCount = note.interactInfo?.collectedCount || 0;

            // 图片 — 直接从 imageList 提取（权威来源）
            if (note.imageList) {
              const seenBases = new Set<string>();
              for (const img of note.imageList) {
                const imgUrl = img.urlDefault || img.url || img.infoList?.[0]?.url;
                if (!imgUrl) continue;
                const base = imgUrl.replace(/[?!].*$/, '');
                if (seenBases.has(base)) continue;
                seenBases.add(base);
                if (enableImageRecognition) {
                  try {
                    const dataUrl = await imageUrlToBase64(imgUrl);
                    mediaUrls.push(dataUrl);
                  } catch {
                    mediaUrls.push(imgUrl);
                  }
                }
                // 开关关闭时：跳过下载/转换，且不收集图片 URL
              }
            }
          }
          break;
        }
      }
    }
  } catch (e) {
    console.error('XHS INITIAL_STATE parse failed:', e);
  }

  // 评论 — 等待 DOM 中出现评论元素后提取
  comments = await waitForComments();
  console.log(`[XHS DEBUG] DOM comment extraction result: ${comments.length} comments`);

  // DOM 降级：INITIAL_STATE 失败时直接从 DOM 提取图片
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
      if (enableImageRecognition) {
        try {
          const dataUrl = await imageUrlToBase64(src);
          mediaUrls.push(dataUrl);
        } catch {
          mediaUrls.push(src);
        }
      }
      // 开关关闭时：跳过下载/转换，且不收集图片 URL
    }
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
