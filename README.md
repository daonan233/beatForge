# BeatForge

BeatForge 是一个完全在本机运行的四轨网页音游工作室。它可以上传歌曲、分析可变节拍、生成简单/普通/困难三档谱面，并提供谱面编辑器和实时游玩判定。

## 本地启动（Windows）

首次运行：

```powershell
npm run setup:local
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

然后打开 [http://localhost:5173](http://localhost:5173)。首次安装会创建项目内的 `.venv` 和 `.venv-ai`，下载 Beat This! 节拍模型、Demucs 人声分离模型，并安装 Basic Pitch ONNX 主旋律模型。AI 环境需要本机安装 Python 3.10 x64；不需要 Docker，也不要求系统预装 FFmpeg。

以后启动只需：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

歌曲、谱面、版本和成绩保存在项目的 `data` 目录中。浏览器本地存储只保存键位、音量、下落速度和延迟设置。

## 常用命令

```powershell
npm run dev          # 同时启动网页和 API
npm run build        # 类型检查并构建生产版本
npm test             # TypeScript 单元测试
npm run test:python  # 规则谱面生成测试
npm start            # 构建后由 http://localhost:8787 提供完整应用
```

## 项目结构

- `apps/web`：Vue 3、PixiJS 曲库/编辑器/游戏界面。
- `apps/server`：Fastify API、SQLite、上传与持久化任务队列。
- `services/analyzer`：Demucs 人声分离、Beat This! 逐拍跟踪、Basic Pitch 主旋律转录、librosa 多频段分析与确定性规则谱面生成器。
- `packages/shared`：前后端共享谱面类型、时间换算与校验。

上传文件支持 MP3、WAV、FLAC、OGG 和 M4A，默认最大 200 MB、最长 20 分钟。请只上传你有权使用的音频。
