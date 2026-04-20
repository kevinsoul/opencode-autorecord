# opencode-autorecord

> Author: https://github.com/kevinsoul
>
> Main purpose: Save all OpenCode session records

> Reference: https://github.com/learningpro/opencode-autosave-conversation


## Key Improvements

1. Added parent session debounce for child session idle events (performance/repetitive writes)
2. Added error isolation for child session reads (robustness)
3. Fixed data loss risk during `session.deleted` (timing issues)
4. Fixed `convertMessages` pseudo-async function (code quality)
5. Parallelized image processing (performance)
6. Added message cache to avoid fetching full history on every idle
7. Centralized storage in ~/opencode-autorecord instead of per-project directories


## Installation

```bash
npm install -g opencode-autorecord
```


## Configuration

Add the plugin to your `opencode.json` (project-level or `~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["opencode-autorecord"]
}
```


## Directory Structure

```
user-home/
├── opencode-autorecord/
│   ├── your-project/
│   │   ├── images/
│   │   │   ├── 20250129-10-30-45-topic-0.png
│   │   │   └── 20250129-10-30-45-topic-1.jpg
│   │   ├── 20250129-10-30-45-implement-auth.md
│   │   └── 20250129-14-22-30-fix-bug.md
│   └── ...
```


## Features

- Automatic file creation when starting a new conversation (user-home/opencode-autorecord)
- Auto-saves to markdown files when session is idle (silent execution, no console output)
- Files named by timestamp and topic: `YYYYMMDD-HH-MM-SS-topic.md`
- Images saved as separate files instead of base64 (keeps Markdown clean)
- Full tool call details preserved (inputs and outputs)
- Child sessions (subagent tasks) inlined within parent files
- Clean, readable Markdown format
- UTF-8 support for Chinese and other Unicode content


## License

[Apache 2.0](https://github.com/kevinsoul/opencode-autorecord/commit/6c59a77af7dafec32ebfcc9c892ed4b0f9a6a06f)