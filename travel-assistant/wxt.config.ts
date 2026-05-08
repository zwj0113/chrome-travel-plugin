import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '旅游攻略助手',
    description: '一键提取视频/图文内容为 Markdown，旅游攻略信息收集利器',
    permissions: ['sidePanel', 'storage', 'downloads', 'activeTab'],
    host_permissions: [
      '*://*.youtube.com/*',
      '*://*.bilibili.com/*',
      '*://*.douyin.com/*',
      '*://*.iesdouyin.com/*',
      '*://*.xiaohongshu.com/*',
      '*://*.xhscdn.com/*',
      '*://api.siliconflow.cn/*',
      '*://api.deepseek.com/*',
    ],
    action: {
      default_title: '旅游攻略助手',
    },
  },
});
