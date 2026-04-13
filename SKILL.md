---
name: film-breakdown
description: 对电影、剧集、动漫或视频进行拉片分析。根据题材自动路由到对应的分析框架，输出有判断的结构化逐段分析。用户说"拉片""分析这部电影""breakdown 这个视频""这部剧的镜头语言怎么样"时使用。
---

# Film Breakdown

## Overview

对影视作品（电影、剧集、动漫）或视频（tech video、vlog、video essay 等）进行结构化拉片分析。

核心能力：
1. 题材路由：根据作品题材加载对应分析框架
2. 结构化分析：按框架骨架逐段输出有判断的分析
3. 视频处理（可选）：场景切割、关键帧提取、字幕解析/转写

## 何时使用

- 用户给出一部作品，要求拉片、分析、breakdown
- 用户问某部作品的镜头语言、叙事结构、视听手法
- 用户想理解一个视频为什么有效/为什么好
- 用户对比两部作品的手法差异

## 三种输入模式

按用户手头有什么走不同路径。不存在"降级"，每种模式都是完整的分析路径。

### 模式 A：对话分析（最常见）

用户看过作品，想讨论和分析。没有本地文件。

**输入**：作品名称 + 用户描述/记忆/问题
**做什么**：
1. 确认题材，加载框架
2. 基于 agent 对作品的知识 + 用户提供的细节，按框架结构化分析
3. 引用具体场景、段落、时间点（基于共同知识）
4. 将分析写成 markdown，用 `generate_report.mjs` 生成 HTML 报告（无关键帧时仅文字排版）

这是拉片最自然的场景。大多数影迷/创作者讨论作品时不会拿着视频文件逐帧看，而是基于观看记忆和理解来分析。

### 模式 B：图片辅助分析

用户提供截图、关键帧、剧照，或者字幕文件。

**输入**：图片文件路径 / 字幕文件 + 作品信息
**做什么**：
1. 用 Read 工具查看图片（Claude 支持多模态）
2. 如有字幕文件，用 `extract_subtitles.mjs` 解析
3. 结合视觉信息 + 文本信息，按框架分析
4. 将分析写成 markdown（引用用户提供的图片），用 `generate_report.mjs` 生成 HTML 报告

### 模式 C：完整视频处理

用户提供本地视频文件或 URL。处理量最大，分析最精细。

**输入**：本地视频文件路径，或 URL（需系统装有 yt-dlp）
**做什么**：

如果输入是 URL，先下载：
```bash
yt-dlp -f 'bestvideo[height<=720]+bestaudio/best[height<=720]' \
  --merge-output-format mp4 -o '/tmp/film-breakdown/<name>/video.%(ext)s' '<URL>'
```
- 限制 720p -- 关键帧分析不需要高分辨率，4K 只会让关键帧体积膨胀、报告臃肿
- 如有字幕，一并下载：`yt-dlp --write-sub --write-auto-sub --sub-lang zh-Hans,zh-CN,en --sub-format srt --skip-download`

然后按下面的视频处理工作流执行

## 视频处理工作流（仅模式 C）

### Step 1: 提取结构化数据

以下步骤可并行执行：

```bash
# 1a. 场景切割 + 关键帧提取
node .agents/skills/film-breakdown/scripts/extract_scenes.mjs \
  --input /path/to/video.mp4 \
  --output /tmp/film-breakdown/scenes/ \
  --threshold 0.3

# 1b. 字幕提取
node .agents/skills/film-breakdown/scripts/extract_subtitles.mjs \
  --input /path/to/video.mp4 \
  --srt /path/to/subtitle.srt

# 1c. 音频转写（仅在无字幕时）
node .agents/skills/film-breakdown/scripts/transcribe.mjs \
  --input /path/to/video.mp4 \
  --output /tmp/film-breakdown/transcript.json \
  --model base
```

### Step 1.5: 压缩关键帧（如需要）

如果关键帧来自高分辨率源或数量过多，压缩以控制报告体积：
```bash
# 将关键帧缩放到宽度 1280px，质量 80
for f in /tmp/film-breakdown/scenes/keyframes/*.jpg; do
  ffmpeg -i "$f" -vf "scale=1280:-1" -q:v 4 -y "$f" 2>/dev/null
done
```
目标：单张关键帧 < 150KB，整份报告 < 3MB。

### Step 2: 构建统一时间轴

```bash
node .agents/skills/film-breakdown/scripts/build_timeline.mjs \
  --scenes /tmp/film-breakdown/scenes/scenes.json \
  --subtitles /tmp/film-breakdown/scenes/subtitles.json \
  --output /tmp/film-breakdown/timeline.json
```

时间轴 schema 见 `references/schema.md`。

### Step 3: 查看关键帧 + 按框架分析

用 Read 工具查看提取出的关键帧图片，结合时间轴数据逐段分析。

### Step 4: 生成静态报告

将分析文本写成 markdown 文件（使用标准 `![alt](path)` 语法引用关键帧），然后生成自包含 HTML 报告：

```bash
node .agents/skills/film-breakdown/scripts/generate_report.mjs \
  --analysis /tmp/film-breakdown/analysis.md \
  --keyframes /tmp/film-breakdown/scenes/keyframes \
  --output /tmp/film-breakdown/report.html
```

报告特性：
- 所有关键帧以 base64 嵌入，单文件可独立阅读
- 东方美学排版：暖纸底色、宋体正文、图片出血、大量留白
- 支持打印（`@media print` 优化）

## 题材路由

1. 用户声明题材，或 agent 根据作品判断
2. 始终加载 `references/frameworks/_base.md`
3. 加载对应题材框架（可多选叠加）

### 叙事影视类

| 题材 | 框架文件 |
|------|----------|
| 科幻 | `sci-fi.md` |
| 奇幻 | `fantasy.md` |
| 恐怖/惊悚 | `horror-thriller.md` |
| 悬疑/推理 | `mystery.md` |
| 犯罪/黑帮 | `crime.md` |
| 动作/冒险 | `action-adventure.md` |
| 战争 | `war.md` |
| 爱情/浪漫 | `romance.md` |
| 喜剧 | `comedy.md` |
| 文艺/作者 | `art-house.md` |
| 历史/传记 | `historical-biopic.md` |
| 武侠/功夫 | `wuxia-martial-arts.md` |
| 赛博朋克 | `cyberpunk.md` |
| 末日/后启示录 | `post-apocalyptic.md` |
| 心理/精神 | `psychological.md` |
| 纪录片 | `documentary.md` |
| 音乐剧/歌舞 | `musical.md` |

### 视频类

| 题材 | 框架文件 |
|------|----------|
| Tech 视频 | `tech-video.md` |
| Vlog | `vlog.md` |
| Video Essay | `video-essay.md` |
| 产品评测 | `product-review.md` |
| 教程 | `tutorial.md` |
| 新闻/时事评论 | `news-commentary.md` |

题材可组合。比如"赛博朋克悬疑片"同时加载 `cyberpunk.md` + `mystery.md`。

## 分析输出

分析必须有深度。一份好的拉片报告应该让读者感到"我看了那么多遍都没注意到这个"。

### 影视类

1. **作品概况** -- 题材、时长、结构类型
2. **整体判断** -- 基于框架的宏观评价，先给结论
3. **逐段分析** -- 按场景/段落/幕，每段包含：
   - 时间码或位置标记（有文件时精确到秒，对话模式下用叙事位置）
   - 关键帧参考（如有）
   - 该段在框架各维度上的分析
4. **专项分析** -- 在逐段分析之外，必须覆盖 `_base.md` 的核心维度：
   - 镜头语言（景别选择、运镜、构图规律）
   - 剪辑（节奏、转场、时间处理）
   - 声音设计（配乐、环境音、静默的使用）
   - 视觉设计（色彩体系、光影、美术）
   - 不是每个维度都写一样多，哪个维度是这部作品最突出的手艺就重点展开
5. **核心手法提炼** -- 值得学习的技巧、创作者的签名式手法

### 视频类

在影视类基础上额外输出：
- 为什么有效（传播机制分析）
- 可复用的结构模式
- 视频类同样需要覆盖视觉/剪辑/声音维度 -- 优秀的 tech video 和 vlog 在这些维度上的手艺不亚于影视作品

### 报告粒度

用户可以指定分析的深度和长度。如果用户没有指定，按以下默认值：

| 粒度 | 适用场景 | 字数参考 | 关键帧密度 |
|------|----------|----------|------------|
| 速览 | 快速了解一部作品的核心手法 | 1000-2000 字 | 3-5 张 |
| 标准（默认） | 完整拉片，覆盖主要维度 | 4000-6000 字 | 每 2-3 分钟一张 |
| 精读 | 逐场景深度拆解，适合学习创作 | 8000-12000 字 | 每 1 分钟一张或更密 |

按内容时长缩放：
- 5 分钟以内的短视频：上述字数 x 0.5
- 5-30 分钟：上述字数 x 1
- 电影长片：上述字数 x 1.5

用户说"简单看看""大概分析一下"时用速览；说"仔细拉一下""逐场景分析"时用精读；没有特别说明时用标准。

## 依赖

模式 A（对话）无外部依赖。模式 B/C 需要：

- `ffmpeg` -- 视频处理、场景检测、关键帧提取
- `whisper` -- 音频转写（可选，仅无字幕时需要；支持 whisper.cpp 或 openai-whisper）

脚本启动时会检查依赖是否可用，缺失时给出安装提示而非直接报错。
模式 C 中如果 ffmpeg 不可用，回退到模式 B（仅处理字幕）或模式 A（纯对话）。

## 约定

- 分析要有判断，不要罗列现象不给结论
- 影视类分析关注"为什么好"（创作手艺），视频类分析关注"为什么有效"（传播机制）
- 不要用学术黑话堆砌，用清晰的语言说明技法和效果的因果关系
- 引用具体时间码和画面，不要泛泛而谈
- 多题材叠加时，优先分析题材交叉产生的独特效果
