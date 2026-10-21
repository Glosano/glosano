import type { Catalog } from '../../i18n'

export const admin: Catalog = {
  'AI settings': 'AI 设置',
  'API key': 'API 密钥',
  Administrator: '管理员',
  Application: '应用',
  Environment: '环境',
  'Configuration source': '配置来源',
  'Connection preset': '连接预设',
  'Connection successful.': '连接成功。',
  'Enable AI': '启用 AI',
  'Enter a new key': '输入新密钥',
  'Keep saved key': '保留已存密钥',
  'No saved key': '无已存密钥',
  'Use no key / remove saved key': '不使用密钥／删除已存密钥',
  'New API key': '新 API 密钥',
  'Load models': '加载模型列表',
  'Model identifier': '模型标识',
  'Other compatible server': '其他兼容服务器',
  'Reload settings': '重新加载设置',
  'Save AI settings': '保存 AI 设置',
  'Saved configuration': '已存配置',
  'Server address': '服务器地址',
  'Test connection': '测试连接',
  'Working…': '正在处理…',
  'AI is blocked by the server environment.': '服务器环境已禁用 AI。',
  'Settings changed elsewhere. Reload before saving.': '设置已在其他位置更改，请重新加载后保存。',
  'Enter a key for this server or choose no key.': '请输入此服务器的密钥，或选择不使用密钥。',
  'The saved key cannot be read. Enter it again or remove it.':
    '无法读取已存密钥，请重新输入或删除。',
  'The instance secret is unsuitable for encryption. Contact the server owner.':
    '实例密钥不适合加密，请联系服务器所有者。',
  'Enter a valid server address. Metadata services are not allowed.':
    '请输入有效地址。不允许访问元数据服务。',
  'Use HTTPS for a public server.': '公共服务器请使用 HTTPS。',
  'Enter the server address and model.': '请输入服务器地址和模型。',
  'Enter a valid API key or choose no key.': '请输入有效 API 密钥，或选择不使用密钥。',
  'The server rejected the API key.': '服务器拒绝了 API 密钥。',
  'The model or endpoint was not found.': '未找到模型或端点。',
  'This server does not list models. Enter the model manually.':
    '此服务器不提供模型列表，请手动输入。',
  'The server is unavailable. Check the address and connection.':
    '服务器不可用，请检查地址和连接。',
  'The server did not respond in time.': '服务器响应超时。',
  'The provider is limiting requests. Try again later.': '提供商限制了请求，请稍后重试。',
  'The server returned an incompatible response.': '服务器返回了不兼容的响应。',
  'The server response was too large.': '服务器响应过大。',
  'One connection for translations, chat and practice. AI is optional.':
    '翻译、聊天和练习共用一个连接。AI 为可选功能。',
  'You can always enter the model identifier manually.': '您始终可以手动输入模型标识。',
  'For a model on the Docker host, use host.docker.internal instead of localhost. The model server must already be running.':
    '模型运行在 Docker 主机上时，请用 host.docker.internal 代替 localhost。模型服务器必须已启动。',
  'Testing sends a short diagnostic request and may incur a provider charge. It does not change your active connection.':
    '测试会发送简短的诊断请求，提供商可能收费。不会更改当前连接。',
  'Models loaded: {{count}}': '已加载模型：{{count}}',
  'Search models': '搜索模型',
  'Choose a model': '选择模型',
  'No matching models. Try another search or enter the identifier manually.':
    '没有匹配的模型。请尝试其他搜索词或手动输入模型标识符。',
  'Choose a model, test the connection, then save the settings.':
    '选择模型，测试连接，然后保存设置。',
}
