# 英语每日录音助手（iPad PWA）

这是一个可离线使用的英语每日录音工具：课内 10 分钟 + 新概念英语第二册 5 分钟、自动课次、月历打卡、本机录音与月底 ZIP 备份。

## 发布到 GitHub Pages

1. 在 GitHub 创建一个新的空仓库，例如 `english-recorder`。
2. 上传本文件夹中的全部内容（`index.html`、`app.js`、`manifest.webmanifest`、`service-worker.js`、`icons` 文件夹和本说明）；不要上传外层文件夹本身。
3. 在仓库打开 **Settings → Pages**。
4. 在 **Build and deployment** 选择 **Deploy from a branch**。
5. 分支选择 `main`，文件夹选择 `/ (root)`，再点击 **Save**。
6. 等待 GitHub 显示网站地址，然后在 iPad Safari 打开该 HTTPS 地址。

也可以发布到 Cloudflare Pages 或任意 HTTPS 静态网站；必须使用 HTTPS，麦克风和离线安装才能正常工作。

## 安装到 iPad 主屏幕

1. 用 **Safari** 打开发布的网址并等待页面完全加载一次。
2. 点击 Safari 底部或顶部的 **分享** 按钮。
3. 选择 **添加到主屏幕**，然后点击 **添加**。
4. 从新出现的“英语录音”图标打开工具。
5. 第一次录音时，选择允许 Safari 使用麦克风。

首次联网加载后，页面可离线打开。若首次添加后仍没有离线，请联网打开一次后关闭再从主屏幕图标重试。

## 本地数据与备份

- 录音与打卡只保存在这台 iPad 的 Safari 网站数据中，不会上传网络。
- 录音格式由 iPad Safari 决定，通常优先 MP4/AAC；页面会显示实际保存格式。
- Safari 的“清除历史记录与网站数据”会删除本工具的录音和记录。
- 建议每天完成后点击“另存到文件”保存一份，且每月底用“📦 一键生成 ZIP”备份整月数据。
- 浏览器不能在后台自动下载 ZIP；打开工具后点一次打包即可。

## 本地检查

电脑安装 Node.js 后，在此文件夹运行：

```powershell
node --test tests/lesson.test.mjs
```

该检查验证 Lesson 79 的起始周、每周自动顺延、10 分钟阶段切换、CSV 转义和离线缓存文件清单。
