import type { AdapterOutput, Comment, Platform } from './types';

const PLATFORM_NAMES: Record<Platform, string> = {
  youtube: 'YouTube',
  bilibili: 'B站',
  douyin: '抖音',
  xiaohongshu: '小红书',
};

function formatMetadata(data: AdapterOutput): string {
  const lines: string[] = [];
  const meta = data.metadata || {};

  lines.push(`📌 来源：${PLATFORM_NAMES[data.platform]} | 作者：${data.author}${data.publishDate ? ` | 发布：${data.publishDate}` : ''}`);
  lines.push(`🔗 ${data.url}`);

  if (data.type === 'video' && meta.views) {
    const parts = [`📊 播放 ${meta.views}`];
    if (meta.likes) parts.push(`点赞 ${meta.likes}`);
    if (meta.favorites) parts.push(`收藏 ${meta.favorites}`);
    lines.push(parts.join(' | '));
  } else if (data.type === 'note') {
    const parts = [];
    if (meta.likes) parts.push(`❤️ 点赞 ${meta.likes}`);
    if (meta.favorites) parts.push(`收藏 ${meta.favorites}`);
    if (parts.length) lines.push(parts.join(' | '));
  }

  return lines.map(l => `> ${l}`).join('\n');
}

function formatComments(comments: Comment[], sort: string, count: number): string {
  if (!comments.length) return '';

  const sorted = [...comments];
  const displayCount = count === 0 ? sorted.length : Math.min(count, sorted.length);
  const items = sorted.slice(0, displayCount);

  const parts = items.map((c, i) => {
    let text = `### [${i + 1}] @${c.author}\n${c.content}`;
    if (c.replies?.length) {
      text += '\n\n' + c.replies.map(r => `> **@${r.author}**：${r.content}`).join('\n\n');
    }
    return text;
  });

  return parts.join('\n\n');
}

export function generateVideoMarkdown(
  data: AdapterOutput,
  transcript: string,
  commentSort: string,
  commentCount: number
): string {
  const sortLabel = commentSort === 'hot' ? '按热度' : '按时间';
  const now = new Date().toLocaleString('zh-CN');

  return [
    `# ${data.title}`,
    '',
    formatMetadata(data),
    '',
    '---',
    '',
    '## 🎬 转录文本',
    '',
    transcript,
    '',
    '---',
    '',
    `## 💬 评论（${sortLabel}，前${commentCount}条）`,
    '',
    formatComments(data.comments, commentSort, commentCount),
    '',
    '---',
    '',
    `*由旅游攻略助手生成 | ${now}*`,
  ].join('\n');
}

export function generateNoteMarkdown(
  data: AdapterOutput,
  imageDescriptions: string[],
  summary: string,
  commentSort: string,
  commentCount: number
): string {
  const sortLabel = commentSort === 'hot' ? '按热度' : '按时间';
  const now = new Date().toLocaleString('zh-CN');
  const imagesSection = imageDescriptions.length
    ? ['## 🖼️ 图片解读', '', ...imageDescriptions.map((desc, i) => `### 图${i + 1}\n${desc}`), '']
    : ['## 🖼️ 图片解读', '', '*图片未能识别*', ''];

  const sections: string[] = [
    `# ${data.title}`,
    '',
    formatMetadata(data),
    '',
    '---',
    '',
    '## 📝 内容总结',
    '',
    summary,
    '',
    '---',
    '',
    ...imagesSection,
    '',
    '---',
    '',
    '## 📖 笔记原文',
    '',
    data.rawText || '*未提取到文本内容*',
    '',
    '---',
    '',
    `## 💬 评论（${sortLabel}，前${commentCount}条）`,
    '',
    formatComments(data.comments, commentSort, commentCount),
    '',
    '---',
    '',
    `*由旅游攻略助手生成 | ${now}*`,
  ];

  return sections.join('\n');
}
