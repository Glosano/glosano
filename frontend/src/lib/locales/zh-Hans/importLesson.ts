import type { Catalog } from '@/lib/i18n'

export const importLessonMessages: Catalog = {
  File: '文件',
  'Import method': '导入方式',
  'Drop a file here': '将文件拖放到此处',
  'Choose file': '选择文件',
  'Choose one file.': '请选择一个文件。',
  'Choose a .txt or .md file.': '请选择 .txt 或 .md 文件。',
  'Only .txt and .md files with text content are supported.':
    '仅支持包含文本内容的 .txt 和 .md 文件。',
  'The file must not exceed 5 MiB.': '文件大小不能超过 5 MiB。',
  'Save the file as UTF-8 and try again.': '请将文件保存为 UTF-8 编码后重试。',
  'The file must contain non-empty text.': '文件必须包含非空文本。',
  'Upload a UTF-8 .txt or .md file, up to 5 MiB. Lesson language: {{language}}.':
    '请上传 UTF-8 编码的 .txt 或 .md 文件，最大 5 MiB。课程语言：{{language}}。',
  'Could not process the lesson. Close this window and try importing again.':
    '无法处理课程。请关闭此窗口后重新导入。',
  'Processing lesson… You can close this window: the import will continue.':
    '正在处理课程… 你可以关闭此窗口，导入会继续进行。',
  'Check status': '查看状态',
}
