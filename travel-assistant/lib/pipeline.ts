import type { AdapterOutput, ExtractConfig, PipelineState, PipelineStep } from './types';
import { transcribeAudio, summarize } from './ai-service';
import { generateVideoMarkdown, generateNoteMarkdown } from './markdown-generator';
import { loadSettings } from './config-manager';

function makeSteps(data: AdapterOutput): PipelineStep[] {
  if (data.type === 'video') {
    return [
      { id: 'extract', label: '提取视频信息', status: 'pending' },
      { id: 'download', label: '下载与处理音频', status: 'pending' },
      { id: 'transcribe', label: '语音转录', status: 'pending' },
      { id: 'summarize', label: '内容总结', status: 'pending' },
      { id: 'comments', label: '抓取评论', status: 'pending' },
      { id: 'generate', label: '生成 Markdown', status: 'pending' },
    ];
  }
  return [
    { id: 'extract', label: '提取笔记信息', status: 'pending' },
    { id: 'images', label: '图片理解', status: 'pending' },
    { id: 'summarize', label: '内容总结', status: 'pending' },
    { id: 'comments', label: '抓取评论', status: 'pending' },
    { id: 'generate', label: '生成 Markdown', status: 'pending' },
  ];
}

function buildState(steps: PipelineStep[], cancelled = false): PipelineState {
  return { steps: [...steps], cancelled };
}

export async function runVideoPipeline(
  data: AdapterOutput,
  config: ExtractConfig,
  onProgress: (state: PipelineState) => void
): Promise<{ markdown: string; filename: string }> {
  const steps = makeSteps(data);
  const update = (id: string, status: PipelineStep['status'], detail?: string) => {
    const step = steps.find((s) => s.id === id);
    if (step) {
      step.status = status;
      if (detail) step.detail = detail;
    }
    onProgress(buildState(steps));
  };

  // 步骤 1: 提取（由适配器完成，这里直接传入了 data）
  update('extract', 'done');
  update('download', 'running');

  // 步骤 2: 下载音频 + 提取
  let audioBlob: Blob | null = null;
  try {
    const response = await fetch(data.mediaUrls[0]);
    if (response.ok) {
      audioBlob = await response.blob();
    }
    update('download', 'done', audioBlob ? `${(audioBlob.size / 1024 / 1024).toFixed(1)}MB` : '通过URL下载');
  } catch (e) {
    update('download', 'error', (e as Error).message);
  }

  // 步骤 3: 转录
  update('transcribe', 'running', '硅基流动');
  let transcript = '';
  try {
    if (audioBlob) {
      const result = await transcribeAudio(audioBlob);
      transcript = result.text;
    }
    update('transcribe', 'done', `${transcript.length}字`);
  } catch (e) {
    update('transcribe', 'error', (e as Error).message);
    transcript = '*音频转录失败*';
  }

  // 步骤 4: 总结
  update('summarize', 'running', 'DeepSeek');
  let summary = '';
  try {
    const content = transcript || data.description || data.title;
    summary = await summarize(content, data.title);
    update('summarize', 'done');
  } catch (e) {
    update('summarize', 'error', (e as Error).message);
    summary = '*内容总结不可用*';
  }

  // 步骤 5: 评论（适配器中已抓取）
  update('comments', 'done', `${data.comments.length}条`);

  // 步骤 6: 生成 Markdown
  update('generate', 'running');
  const settings = await loadSettings();
  const markdown = generateVideoMarkdown(
    data,
    transcript,
    summary,
    config.commentSort || settings.defaultCommentSort,
    config.commentCount || settings.defaultCommentCount
  );
  update('generate', 'done', `${markdown.length}字`);

  const filename = `${data.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;

  return { markdown, filename };
}

export async function runNotePipeline(
  data: AdapterOutput,
  config: ExtractConfig,
  onProgress: (state: PipelineState) => void
): Promise<{ markdown: string; filename: string }> {
  const { describeImage } = await import('./ai-service');
  const steps = makeSteps(data);
  const update = (id: string, status: PipelineStep['status'], detail?: string) => {
    const step = steps.find((s) => s.id === id);
    if (step) {
      step.status = status;
      if (detail) step.detail = detail;
    }
    onProgress(buildState(steps));
  };

  update('extract', 'done');

  // 步骤 2: 图片理解
  update('images', 'running');
  const imageDescs: string[] = [];
  for (const imgUrl of data.mediaUrls) {
    try {
      const desc = await describeImage(imgUrl);
      imageDescs.push(desc);
    } catch {
      imageDescs.push('*图片无法识别*');
    }
  }
  update('images', 'done', `${imageDescs.length}张`);

  // 步骤 3: 总结
  update('summarize', 'running', 'DeepSeek');
  let summary = '';
  try {
    summary = await summarize(data.rawText || data.title, data.title);
    update('summarize', 'done');
  } catch (e) {
    update('summarize', 'error');
    summary = '*内容总结不可用*';
  }

  // 步骤 4: 评论
  update('comments', 'done', `${data.comments.length}条`);

  // 步骤 5: 生成
  update('generate', 'running');
  const settings = await loadSettings();
  const markdown = generateNoteMarkdown(
    data,
    imageDescs,
    summary,
    config.commentSort || settings.defaultCommentSort,
    config.commentCount || settings.defaultCommentCount
  );
  update('generate', 'done', `${markdown.length}字`);

  const filename = `${data.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;

  return { markdown, filename };
}
