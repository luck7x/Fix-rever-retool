# Fix-rever-retool

AI API Adapter for Cloudflare Workers

## 📖 项目来源

本项目基于 [Rever by Shinplex](https://github.com/Shinplex/rever) 项目进行修改，原项目使用 APGL-3.0 许可证。

**原项目地址：** https://github.com/Shinplex/rever

感谢 Shinplex 提供的优秀开源项目！

## 🔧 主要修改内容

### 1. **TypeScript → JavaScript 转换**
- 移除所有 TypeScript 类型定义（`type`, `interface`, `<T>` 等）
- 移除类型注解和类型断言
- 确保与 Cloudflare Workers 网页编辑器兼容

### 2. **修复全局异步操作问题**
- **原代码问题：** 在全局作用域中执行异步初始化，违反 Cloudflare Workers 限制
- **修复方案：** 改为在第一次请求时进行初始化
- 添加 `INITIALIZED` 标志防止重复初始化

### 3. **增强调试功能**
- 扩展 `/debug` 端点，提供更详细的状态信息
- 显示初始化状态、模型数量、账户状态等

### 4. **优化错误处理**
- 改进错误日志输出
- 增加更详细的调试信息

## 🚀 部署指南

### 第1步：创建 Cloudflare Worker
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 "Workers & Pages"
3. 点击 "Create application" → "Create Worker"
4. 给 Worker 命名（如：`retool-api`）

### 第2步：配置代码
复制完整代码到编辑器，然后修改以下配置：

#### 🔑 客户端密钥配置
```javascript
const VALID_CLIENT_KEYS = new Set([
  "sk-your-key-123456",        // 替换为你的密钥
  "sk-your-key-789012",        // 可以添加多个密钥
]);
```

#### 🏢 Retool 账户配置
```javascript
const RETOOL_ACCOUNTS = [
  {
    domain_name: "your-company.retool.com",    // 替换为你的 Retool 域名
    x_xsrf_token: "your-xsrf-token-here",     // 从浏览器获取
    accessToken: "your-access-token-here",     // 从浏览器获取
    is_valid: true,
    last_used: 0,
    error_count: 0,
    agents: [],
  },
];
```

### 第3步：获取 Retool 认证信息

#### 📋 详细步骤：
1. **登录你的 Retool 账户**
2. **打开浏览器开发者工具**（按 F12）
3. **切换到 "应用"标签页**
4. **在 Retool 页面中刷新页面**
5. **找到cookie**
6. **找到任意一个发送到你域名的请求**
7. **复制以下信息：**
   - **域名：** 从地址栏获取（如：`mycompany.retool.com`）
   - **x-xsrf-token：** 
   - **accessToken：** 

### 第4步：部署
1. 点击 "Save and Deploy"
2. 等待部署完成
3. 获得 Worker URL：`https://your-worker-name.your-username.workers.dev`

### 第5步：使用
URL：https://your-worker-name.your-username.workers.dev
密钥：“SK-demo-xxx”  

## 📡 API 端点

### 🔍 获取可用模型
```bash
# 公开端点（无需认证）
GET https://your-worker.workers.dev/models

# 需要认证的端点
GET https://your-worker.workers.dev/v1/models
Authorization: Bearer sk-your-key-123456
```

**响应示例：**
```json
{
  "object": "list",
  "data": [
    {
      "id": "claude-3-sonnet",
      "object": "model",
      "created": 1234567890,
      "owned_by": "anthropic",
      "name": "My Claude Agent (claude-3-sonnet-20240229)"
    }
  ]
}
```

### 💬 聊天对话
```bash
# 非流式响应
POST https://your-worker.workers.dev/v1/chat/completions
Authorization: Bearer sk-your-key-123456
Content-Type: application/json

{
  "model": "claude-3-sonnet",
  "messages": [
    {"role": "user", "content": "Hello, how are you?"}
  ]
}
```

```bash
# 流式响应
POST https://your-worker.workers.dev/v1/chat/completions
Authorization: Bearer sk-your-key-123456
Content-Type: application/json

{
  "model": "claude-3-sonnet",
  "messages": [
    {"role": "user", "content": "Hello, how are you?"}
  ],
  "stream": true
}
```

### 🐛 调试端点
```bash
# 查看系统状态
GET https://your-worker.workers.dev/debug

# 启用调试模式
GET https://your-worker.workers.dev/debug?enable=true

# 禁用调试模式
GET https://your-worker.workers.dev/debug?enable=false
```

**调试响应示例：**
```json
{
  "debug_mode": true,
  "initialized": true,
  "models_count": 2,
  "accounts": [
    {
      "domain": "mycompany.retool.com",
      "agents_count": 3,
      "is_valid": true,
      "error_count": 0
    }
  ]
}
```



### Q: 支持哪些模型？
**A:** 系统会自动发现你在 Retool 中创建的所有 AI Agents 使用的模型，包括：
- OpenAI GPT 系列
- Anthropic Claude 系列
- 其他 Retool 支持的模型

## 📄 许可证

本项目继承原项目的 AGPL-3.0 许可证。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**快速链接：**
- 🔗 **模型列表：** `https://your-worker.workers.dev/models`
- 🐛 **调试信息：** `https://your-worker.workers.dev/debug`
- 📚 **原项目：** https://github.com/Shinplex/rever
