# Timeline Schema

统一时间轴的 JSON 格式定义。所有脚本的输出最终合并到这个结构。

## 顶层结构

```json
{
  "version": 1,
  "source": {
    "path": "/path/to/video.mp4",
    "title": "影片标题",
    "duration_seconds": 7200,
    "resolution": "1920x1080",
    "fps": 24
  },
  "scenes": [ ... ],
  "subtitles": [ ... ],
  "transcript": [ ... ]
}
```

## Scene 对象

```json
{
  "index": 0,
  "start": 0.0,
  "end": 12.5,
  "duration": 12.5,
  "keyframe": "keyframes/scene_000.jpg"
}
```

- `start` / `end`: 秒，浮点数
- `keyframe`: 相对于输出目录的路径

## Subtitle 对象

```json
{
  "index": 0,
  "start": 1.2,
  "end": 3.8,
  "text": "对白内容"
}
```

## Transcript 对象

whisper 转写输出，格式同 Subtitle，额外字段：

```json
{
  "index": 0,
  "start": 1.2,
  "end": 3.8,
  "text": "转写内容",
  "confidence": 0.92,
  "language": "zh"
}
```

## 合并规则

`build_timeline.mjs` 的合并逻辑：

1. scenes 作为骨架，定义段落边界
2. subtitles/transcript 按时间码归入对应 scene
3. 如果同时有 subtitles 和 transcript，优先 subtitles，transcript 作为补充
4. 合并后每个 scene 包含该时间段内的所有文本

## 合并后的 Scene 结构

```json
{
  "index": 0,
  "start": 0.0,
  "end": 12.5,
  "duration": 12.5,
  "keyframe": "keyframes/scene_000.jpg",
  "dialogue": [
    { "start": 1.2, "end": 3.8, "text": "对白内容", "source": "subtitle" }
  ]
}
```
