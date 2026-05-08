import { describe, it, expect } from 'vitest';
import { generateVideoMarkdown, generateNoteMarkdown } from '../lib/markdown-generator';
import type { AdapterOutput, Comment } from '../lib/types';

const videoAdapterOutput: AdapterOutput = {
  platform: 'bilibili',
  type: 'video',
  url: 'https://bilibili.com/video/BV1xx',
  title: '大阪5日游攻略',
  author: '旅行达人',
  publishDate: '2026-03-15',
  description: '大阪旅游完整路线规划',
  mediaUrls: ['https://example.com/video.mp4'],
  comments: [
    { author: '用户A', content: '很详细的攻略！', likes: 120, time: '2026-03-16' },
    { author: '用户B', content: '收藏了', likes: 45, time: '2026-03-17' },
  ],
  metadata: { views: 123000, likes: 8456, favorites: 5201 },
};

describe('Markdown Generator', () => {
  describe('generateVideoMarkdown', () => {
    it('generates complete markdown for video content', () => {
      const transcript = '大家好，今天给大家分享大阪5日游攻略。第一天我们到达关西机场...';
      const summary = '本视频介绍了大阪5日游的完整路线规划。';

      const md = generateVideoMarkdown(videoAdapterOutput, transcript, summary, 'hot', 50);

      expect(md).toContain('# 大阪5日游攻略');
      expect(md).toContain('📌 来源：B站');
      expect(md).toContain('作者：旅行达人');
      expect(md).toContain('## 📝 内容总结');
      expect(md).toContain(summary);
      expect(md).toContain('## 🎬 转录文本');
      expect(md).toContain(transcript);
      expect(md).toContain('## 💬 评论');
      expect(md).toContain('@用户A');
      expect(md).toContain('很详细的攻略！');
      expect(md).toContain('@用户B');
      expect(md).toContain('收藏了');
      expect(md).toContain('*由旅游攻略助手生成');
    });

    it('includes metadata when available', () => {
      const md = generateVideoMarkdown(videoAdapterOutput, 'test', 'sum', 'hot', 50);
      expect(md).toContain('📊 播放');
      expect(md).toContain('123000');
      expect(md).toContain('8456');
    });
  });

  describe('generateNoteMarkdown', () => {
    const noteAdapterOutput: AdapterOutput = {
      platform: 'xiaohongshu',
      type: 'note',
      url: 'https://xiaohongshu.com/explore/abc',
      title: '京都赏樱5大绝美地点',
      author: '樱花酱',
      publishDate: '2026-04-01',
      mediaUrls: ['https://img1.jpg', 'https://img2.jpg'],
      rawText: '今天分享京都最美的5个赏樱地点，第一个是岚山...',
      comments: [],
      metadata: { likes: 2341, favorites: 8902 },
    };

    it('generates complete markdown for note content', () => {
      const imageDescriptions = ['第一张图：岚山竹林中的樱花步道', '第二张图：清水寺俯瞰樱花全景'];
      const summary = '本文推荐了京都5个最佳赏樱地点。';

      const md = generateNoteMarkdown(noteAdapterOutput, imageDescriptions, summary, 'hot', 20);

      expect(md).toContain('# 京都赏樱5大绝美地点');
      expect(md).toContain('📌 来源：小红书');
      expect(md).toContain('作者：樱花酱');
      expect(md).toContain('❤️ 点赞');
      expect(md).toContain('## 📝 内容总结');
      expect(md).toContain(summary);
      expect(md).toContain('## 🖼️ 图片解读');
      expect(md).toContain('### 图1');
      expect(md).toContain('岚山竹林中的樱花步道');
      expect(md).toContain('### 图2');
      expect(md).toContain('清水寺俯瞰樱花全景');
      expect(md).toContain('## 📖 笔记原文');
      expect(md).toContain('今天分享京都最美');
    });
  });
});
