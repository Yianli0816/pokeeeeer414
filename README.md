# 414 扑克牌 · Node.js + Socket.IO 联机版

这是一个 **权威服务端（防作弊）** 的 414 扑克牌联机项目：洗牌、发牌、出牌合法性校验、叉/勾拦截判定和积分升级全部在 Node.js 服务端完成，每位玩家只会收到自己的手牌数据。

## 一、本地运行测试

1. 确保已安装 [Node.js](https://nodejs.org/)（18 及以上版本）。
2. 在本目录下打开终端，安装依赖并启动：
   ```bash
   npm install
   npm start
   ```
3. 浏览器打开 `http://localhost:3000` 即可创建房间或加入房间（支持 1~4 人，空位由服务端 AI 自动补齐）。

## 二、部署成公开网站（推荐免费平台）

由于本项目包含 WebSocket 实时后端，推荐直接部署到支持 Node.js 长连接的平台（前后端一体，无需额外配置跨域）：

- **Render / Railway / Zeabur**：
  1. 将本文件夹上传到你的 GitHub 仓库。
  2. 在 [Render](https://render.com/)、[Railway](https://railway.app/) 或 [Zeabur](https://zeabur.com/) 新建 Web Service 并关联该仓库。
  3. 启动命令填 `npm start`，部署完成后即可获得一个公开 `https://...` 网址，发给好友即可直接联机。
- **前后端分离（可选）**：
  - 如果你把 `public/index.html` 单独部署到 Vercel / Cloudflare Pages，只需在网页右上角「联机」弹窗的「服务端地址」里填入你部署好的后端 `https://...` 域名即可连接。
