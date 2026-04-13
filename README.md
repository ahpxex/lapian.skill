# 拉片.SKILL

对电影、剧集、动漫或视频进行结构化拉片分析，输出带关键帧的静态 HTML 报告。

[English version](https://github.com/ahpxex/film-breakdown-skill)

---

## 它做什么

给一部作品（电影、剧集、YouTube 视频、tech video、vlog...），按题材自动加载对应的分析框架，从镜头语言、剪辑、声音设计、视觉设计、叙事结构等维度进行拉片，生成一份图文并排的静态 HTML 报告。

## 安装

```bash
npx skills add ahpxex/lapian.skill
```

## 三种输入模式

| 模式 | 输入 | 说明 |
|---|---|---|
| A. 对话 | 作品名称 | 最常见。基于共同知识按框架分析。 |
| B. 图片辅助 | 截图、关键帧、字幕文件 | Claude 看图 + 文本辅助分析。 |
| C. 完整视频 | 本地视频文件或 URL | 自动切割场景、提取关键帧、解析字幕，完整流水线。 |

## 三档粒度

| 粒度 | 字数参考 | 说明 |
|---|---|---|
| 速览 | 1000-2000 字 | "简单看看" |
| 标准（默认） | 4000-6000 字 | 完整拉片，覆盖主要维度 |
| 精读 | 8000-12000 字 | 逐场景深度拆解，适合学习创作 |

## 支持的题材

**叙事影视类：**
科幻、奇幻、恐怖/惊悚、悬疑、犯罪、动作/冒险、战争、爱情、喜剧、文艺/作者、历史/传记、武侠、赛博朋克、末日、心理、纪录片、音乐剧

**视频类：**
Tech 视频、Vlog、Video Essay、产品评测、教程、新闻/时事评论

题材可组合。比如"赛博朋克悬疑片"会同时加载两个框架。

## 报告样式

生成的 HTML 报告是单文件、自包含的（关键帧以 base64 嵌入），可以离线阅读、可以打印。

排版自动识别内容语言：
- **中文内容**：宋体正文、暖纸底色、图片出血、大量留白，东方美学
- **英文内容**：Georgia 衬线体、稍大字号、更紧凑的行高

## 系统依赖

模式 A（对话）不需要任何外部依赖。模式 B/C 需要：

- **ffmpeg** -- 场景检测、关键帧提取
  ```bash
  brew install ffmpeg
  ```
- **yt-dlp**（可选） -- 从 URL 下载视频
  ```bash
  brew install yt-dlp
  ```
- **whisper**（可选） -- 音频转写，仅无字幕时需要
  ```bash
  pip install openai-whisper
  ```

## 使用

安装后直接对 Claude Code 说：

- "帮我拉一下星际牛仔最后一集"
- "分析这个视频 https://youtube.com/watch?v=..."
- "breakdown /path/to/video.mp4，精读级别"
- "这部电影的镜头语言怎么样"

## 项目结构

```
SKILL.md                          # Skill 定义（中文）
references/
  schema.md                       # 时间轴 JSON schema
  frameworks/
    _base.md                      # 基础分析框架（7 个通用维度）
    sci-fi.md, crime.md, ...      # 23 个题材特化框架
scripts/
  extract_scenes.mjs              # 场景切割 + 关键帧提取
  extract_subtitles.mjs           # 字幕解析（SRT/ASS/VTT + 内嵌）
  transcribe.mjs                  # Whisper 音频转写
  build_timeline.mjs              # 统一时间轴构建
  generate_report.mjs             # HTML 报告生成
```

## License

MIT
