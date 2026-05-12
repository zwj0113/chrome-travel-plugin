import { getApiKey } from './config-manager';

const SILICONFLOW_ASR_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/v1/chat/completions';
const KIMI_CHAT_URL = 'https://api.moonshot.cn/v1/chat/completions';

export async function transcribeAudio(audioBlob: Blob): Promise<{ text: string }> {
  const apiKey = await getApiKey('siliflow');
  if (!apiKey) throw new Error('缺少硅基流动 API Key');

  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.wav');
  formData.append('model', 'FunAudioLLM/SenseVoiceSmall');

  const res = await fetch(SILICONFLOW_ASR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`硅基流动 API 错误 (${res.status}): ${errText}`);
  }

  return res.json();
}

export async function describeImage(imageUrl: string): Promise<string> {
  const apiKey = await getApiKey('kimi');
  if (!apiKey) throw new Error('缺少 Kimi API Key');

  // 如果还不是 data URL，先下载图片并转 base64（绕过防盗链）
  let dataUrl = imageUrl;
  if (!imageUrl.startsWith('data:')) {
    const imgShort = imageUrl.slice(0, 80);
    try {
      const imgResp = await fetch(imageUrl, {
        headers: { Referer: 'https://www.xiaohongshu.com/' },
      });
      if (imgResp.ok) {
        const blob = await imgResp.blob();
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.slice(i, i + CHUNK));
        }
        const base64 = btoa(binary);
        const mime = blob.type || 'image/jpeg';
        dataUrl = `data:${mime};base64,${base64}`;
      } else {
        console.warn(`[travel-assistant] describeImage: download failed, status=${imgResp.status}, url=${imgShort}`);
      }
    } catch (e) {
      console.warn(`[travel-assistant] describeImage: download error: ${(e as Error).message}, url=${imgShort}`);
    }
  }

  const dataUrlSize = dataUrl.length;
  console.log(`[travel-assistant] describeImage: calling Kimi API, imageSize=${(dataUrlSize / 1024).toFixed(0)}KB`);

  const res = await fetch(KIMI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'kimi-k2.6',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '只提取这张图片中的所有文字内容，直接输出文字，不要有任何解释。如果图片中没有文字，只回复"无文字"。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[travel-assistant] describeImage: Kimi API error ${res.status}: ${errText.slice(0, 300)}`);
    throw new Error(`Kimi 图片理解错误 (${res.status}): ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  let content = message?.content;
  // kimi-k2.6 是推理模型，当 max_tokens 不足时 content 可能为空，回退到 reasoning_content
  if (!content && message?.reasoning_content) {
    console.log(`[travel-assistant] describeImage: content empty, falling back to reasoning_content (${message.reasoning_content.length} chars)`);
    content = message.reasoning_content;
  }
  if (!content) {
    console.error('[travel-assistant] describeImage: unexpected response format:', JSON.stringify(data).slice(0, 500));
    throw new Error('Kimi 图片理解返回了意外的响应格式');
  }
  console.log(`[travel-assistant] describeImage: success, outputLen=${content.length}, finishReason=${data?.choices?.[0]?.finish_reason}`);
  return content;
}

export async function formatTranscript(
  transcript: string,
  videoTitle: string,
  platform: string,
  videoUrl: string,
): Promise<string> {
  const apiKey = await getApiKey('deepseek');
  if (!apiKey) throw new Error('缺少 DeepSeek API Key');

  const prompt = `你是视频转录文本的智能处理专家。请对下面这段语音转写文本进行**智能纠错与格式化**。

## 输入信息
- 视频标题：${videoTitle}
- 来源平台：${platform}
- 视频链接：${videoUrl}

## 纠错原则

1. **字词纠错**：根据上下文修正常见误识别词
2. **语气词处理**：精简重复的语气词和口头禅，但保留必要的语气词
3. **语义连贯**：确保纠错后语句通顺、语义连贯
4. **专业术语**：根据视频主题保留正确的专业术语
5. **最小改动**：尽量保留原文结构和表达方式，只做必要修正

## 格式化原则

1. 根据语义完整性和内容逻辑进行分段
2. 每段应该是内容相对完整的句子或论述
3. 保持原文内容不变，只添加合理的段落分隔
4. 适当添加###小标题概括每段主旨（如果内容足够长）

## 重要要求

- 请输出**完整**的纠错后文本，不要截断、不要省略、不要总结
- 直接输出处理后的内容，不要添加任何解释说明
- 不要用代码块包裹输出`;

  // max_tokens 按输入长度宽松估算（模型支持 1M 上下文，无需截断输入）
  const outputTokens = Math.max(16000, Math.ceil(transcript.length * 1.5));

  const body = JSON.stringify({
    model: 'deepseek-v4-pro',
    messages: [
      { role: 'user', content: `${prompt}\n\n以下是需要处理的转录文本：\n\n${transcript}` },
    ],
    max_tokens: outputTokens,
  });

  console.log('[travel-assistant] formatTranscript request - key=', apiKey ? `***${apiKey.slice(-4)}` : 'EMPTY', 'transcriptLen=', transcript.length, 'maxTokens=', outputTokens);

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  console.log('[travel-assistant] formatTranscript response - status=', res.status, 'ok=', res.ok);

  if (!res.ok) {
    const errText = await res.text();
    console.error('[travel-assistant] formatTranscript error body:', errText.slice(0, 500));
    throw new Error(`DeepSeek 纠错格式化错误 (${res.status}): ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  console.log('[travel-assistant] formatTranscript response data - hasChoices=', !!data?.choices, 'choicesLen=', data?.choices?.length);

  const choice = data?.choices?.[0];
  const finishReason = choice?.finish_reason;
  const result = choice?.message?.content;
  console.log('[travel-assistant] formatTranscript result - finishReason=', finishReason, 'outputLen=', result?.length || 0);

  if (!result) {
    console.error('[travel-assistant] formatTranscript unexpected response:', JSON.stringify(data).slice(0, 500));
    throw new Error('DeepSeek 纠错格式化返回了意外的响应格式');
  }
  return result;
}

export async function summarize(content: string, context: string): Promise<string> {
  const apiKey = await getApiKey('deepseek');
  if (!apiKey) throw new Error('缺少 DeepSeek API Key');

  const body = JSON.stringify({
    model: 'deepseek-v4-pro',
    messages: [
      {
        role: 'system',
        content: '你是一个旅游攻略助手。请将以下内容总结为简洁的要点摘要，突出关键信息（景点、美食、交通、住宿、费用等），用中文回答。',
      },
      { role: 'user', content: `【标题】${context}\n\n【内容】\n${content.slice(0, 8000)}` },
    ],
    max_tokens: 1500,
  });

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek 总结错误 (${res.status}): ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const result = data?.choices?.[0]?.message?.content;
  if (!result) {
    throw new Error('DeepSeek 总结返回了意外的响应格式');
  }
  return result;
}
