import { getApiKey } from './config-manager';

const SILICONFLOW_ASR_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/v1/chat/completions';

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
  const apiKey = await getApiKey('deepseek');
  if (!apiKey) throw new Error('缺少 DeepSeek API Key');

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请详细描述这张图片的内容，包括场景、人物、物品、文字等。用中文回答。' },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 1000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek 图片理解错误 (${res.status}): ${errText}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`DeepSeek 图片理解返回了意外的响应格式`);
  }
  return content;
}

export async function summarize(content: string, context: string): Promise<string> {
  const apiKey = await getApiKey('deepseek');
  if (!apiKey) throw new Error('缺少 DeepSeek API Key');

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      messages: [
        {
          role: 'system',
          content: '你是一个旅游攻略助手。请将以下内容总结为简洁的要点摘要，突出关键信息（景点、美食、交通、住宿、费用等），用中文回答。',
        },
        { role: 'user', content: `【标题】${context}\n\n【内容】\n${content.slice(0, 8000)}` },
      ],
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek 总结错误 (${res.status}): ${errText}`);
  }
  const data = await res.json();
  const result = data?.choices?.[0]?.message?.content;
  if (!result) {
    throw new Error(`DeepSeek 总结返回了意外的响应格式`);
  }
  return result;
}
