import { type Catalog, ctx } from '@/lib/i18n'

export const videoMessages: Catalog = {
  'Pressing Play connects your browser to YouTube.': '点击播放后，浏览器会连接到 YouTube。',
  'Processing lesson…': '正在处理课程…',
  'Video player': '视频播放器',
  'Play fragment': '播放片段',
  'Replay fragment': '重播片段',
  Pause: '暂停',
  'Creator captions': '作者字幕',
  'Automatic captions': '自动字幕',
  'Could not open the video. You can still study the text.': '无法打开视频。你仍然可以学习文本。',
  'Open on YouTube': '在 YouTube 上打开',
  'Your browser blocked playback. Press ▶ again.': '浏览器阻止了播放。请再次点击 ▶。',
  [ctx('video', 'Stop')]: '停止',
  'Play on turn': '翻页时播放',
  'Advance automatically': '自动翻页',
  'Page turning': '翻页方式',
  More: '更多',
  'Pin video': '固定视频',
  'Shrink video': '缩小视频',
  'New words on the page you leave become known. You can undo this.':
    '离开的页面上的新词会变为已知。你可以撤销此操作。',
  'New words in the fragment you leave become known. You can undo this.':
    '离开的片段中的新词会变为已知。你可以撤销此操作。',
  'Saving page progress…': '正在保存页面进度…',
  'Saving fragment progress…': '正在保存片段进度…',
  'Could not save the page. Retry saving, then press Play.':
    '无法保存页面。请重新保存，然后点击播放。',
  'Could not save the fragment. Retry saving, then press Play.':
    '无法保存片段。请重新保存，然后点击播放。',
  'Play from {{time}}': '从 {{time}} 开始播放',
  'By fragment': '按片段',
  'Previous fragment': '上一个片段',
  'Next fragment': '下一个片段',
  'YouTube link': 'YouTube 链接',
  Import: '导入',
  'Retry import': '重新导入',
  'Import the title and captions from YouTube. Language: {{language}}.':
    '从 YouTube 导入标题和字幕。语言：{{language}}。',
  'Prefer creator captions, then automatic captions in the same language.':
    '优先使用作者字幕，其次使用同一语言的自动字幕。',
  'Could not reach YouTube. Try importing again.': '无法连接到 YouTube。请重新尝试导入。',
  'YouTube blocked requests from this server. Try again later.':
    'YouTube 拒绝了来自此服务器的请求。请稍后再试。',
  'This video has no captions in your learning language.': '该视频没有你所学语言的字幕。',
  'Captions are unavailable for this video.': '该视频没有可用字幕。',
  'Video unavailable. Check the link and access to the video.':
    '视频不可用。请检查链接以及视频的访问权限。',
  'Could not retrieve the title. Check access to the video.':
    '无法获取视频标题。请检查视频的访问权限。',
  'Captions contain invalid text or timestamps.': '字幕包含无效的文字或时间戳。',
  'Captions exceed the limit: 5 MiB, 20,000 cues or 6 hours.':
    '字幕超出上限：5 MiB、20,000 条字幕或 6 小时。',
  'Import timed out. Try again.': '导入超时。请重试。',
  'Enter an HTTPS link to a single YouTube video.': '请输入单个 YouTube 视频的 HTTPS 链接。',
  'Could not import this video. Try again later.': '无法导入此视频。请稍后再试。',
  'Edit text within each fragment. Timing and order stay the same.':
    '可在每个片段内编辑文字，时间和顺序保持不变。',
  'Fragment {{number}} · {{range}}': '片段 {{number}} · {{range}}',
  'The material has changed or is still processing. Reload before saving.':
    '学习材料已更改或仍在处理中。请刷新页面后再保存。',
}
