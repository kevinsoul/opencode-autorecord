/* opencode-autorecord — landing page interactions */

(() => {
  "use strict";

  /* ---------------- i18n ---------------- */

  const I18N = {
    "nav.features": { en: "Features", zh: "功能特性" },
    "nav.storage": { en: "Storage", zh: "存储结构" },
    "nav.usage": { en: "Usage", zh: "使用方式" },
    "nav.faq": { en: "FAQ", zh: "常见问题" },
    "nav.github": { en: "GitHub", zh: "GitHub" },

    "hero.badge": { en: "Free &amp; open source · OpenCode plugin", zh: "免费开源 · OpenCode 插件" },
    "hero.title.1": { en: "The dashcam for", zh: "opencode的" },
    "hero.title.2": { en: "OpenCode", zh: "行车记录仪" },
    "hero.sub": {
      en: "An OpenCode plugin that quietly archives every session to clean Markdown — images extracted, subagents inlined, HTML views generated. One line of config, zero noise.",
      zh: "一个 OpenCode 插件，把每一次会话静默归档为干净的 Markdown——图片自动提取、子会话内联、HTML 视图自动生成。一行配置，零打扰。",
    },

    "code.config": { en: "opencode.json", zh: "opencode.json" },
    "code.cli": { en: "CLI", zh: "CLI" },
    "code.copy": { en: "Copy", zh: "复制" },

    "numbers.config.value": { en: "1", zh: "1" },
    "numbers.config.unit": { en: "line of config", zh: "行配置" },
    "numbers.config.label": { en: "zero dependencies to manage", zh: "无需管理任何依赖" },
    "numbers.local.value": { en: "100%", zh: "100%" },
    "numbers.local.unit": { en: "local", zh: "本地存储" },
    "numbers.local.label": { en: "stored in your home directory", zh: "全部保存在你的主目录" },
    "numbers.views.value": { en: "2", zh: "2" },
    "numbers.views.unit": { en: "HTML views", zh: "层 HTML 视图" },
    "numbers.views.label": { en: "metadata index + full pages", zh: "元数据索引 + 完整页面" },
    "numbers.license.value": { en: "A2", zh: "A2" },
    "numbers.license.unit": { en: "license", zh: "开源协议" },
    "numbers.license.label": { en: "Apache 2.0, free forever", zh: "Apache 2.0，永久免费" },

    "features.title": { en: "What it does", zh: "它能做什么" },
    "features.sub": { en: "Everything happens in the background — you just keep coding.", zh: "一切都在后台静默完成——你只管继续写代码。" },
    "features.idle.title": { en: "Auto-save on idle", zh: "空闲自动保存" },
    "features.idle.desc": {
      en: "Sessions are saved 2 seconds after going idle — silently, with no console output. Deleted or compacted sessions are flushed immediately.",
      zh: "会话空闲 2 秒后自动保存，静默执行、无控制台输出。删除或压缩会话时立即落盘，不留数据丢失窗口。",
    },
    "features.subagent.title": { en: "Subagent inlining", zh: "子会话内联" },
    "features.subagent.desc": {
      en: "Child sessions (subagent tasks) are merged into the parent session's Markdown file — no scattered files, one complete record per conversation.",
      zh: "子会话（subagent 任务）合并到父会话的 Markdown 文件中——没有散落的文件，一次对话一份完整记录。",
    },
    "features.images.title": { en: "Images as files", zh: "图片独立保存" },
    "features.images.desc": {
      en: "Base64 images are extracted and saved as standalone files with local paths — your Markdown stays clean and readable.",
      zh: "base64 图片自动提取为独立文件并替换为本地路径——Markdown 保持简洁易读。",
    },
    "features.views.title": { en: "Two-tier HTML views", zh: "双级 HTML 视图" },
    "features.views.desc": {
      en: "A metadata-only index page links to per-project pages with full conversations — dark code blocks, language labels, copy buttons, session modals.",
      zh: "仅含元数据的索引页链接到各项目页，完整对话以深色代码块呈现，带语言标签、复制按钮和会话详情弹窗。",
    },
    "features.index.title": { en: "Incremental indexing", zh: "增量索引" },
    "features.index.desc": {
      en: "A two-level index system (global + per-project) compares mtime and size — only changed projects are re-parsed, so regeneration is fast.",
      zh: "两级索引体系（全局 + 项目级）通过对比 mtime 和 size 判断变更——只重建有变化的项目，视图再生成极快。",
    },
    "features.safety.title": { en: "Error isolation", zh: "错误隔离" },
    "features.safety.desc": {
      en: "Every event error is caught and swallowed so the plugin never affects your other plugins. File locks prevent concurrent writes.",
      zh: "所有事件错误都被捕获并静默处理，绝不影响你的其他插件；文件锁防止并发写入冲突。",
    },

    "storage.title": { en: "One clean home for everything", zh: "所有记录，一个整洁的家" },
    "storage.desc.1": {
      en: "Records live in <code>~/opencode-autorecord/</code> — never in your project directory, never polluting your git history.",
      zh: "记录保存在 <code>~/opencode-autorecord/</code>——绝不写入项目目录，绝不污染你的 git 历史。",
    },
    "storage.desc.2": {
      en: "Files are named by timestamp and topic: <code>YYYYMMDD-HH-MM-SS-topic.md</code>. Full tool calls (inputs and outputs), reasoning steps, and Chinese/Unicode content are preserved.",
      zh: "文件按时间戳和主题命名：<code>YYYYMMDD-HH-MM-SS-主题.md</code>。完整的工具调用（输入输出）、推理过程和中英文内容都完整保留。",
    },
    "storage.check.1": { en: "Centralized storage outside project directories", zh: "集中存储在项目目录之外" },
    "storage.check.2": { en: "Every conversation becomes a plain-text Markdown file", zh: "每次对话都是一份纯文本 Markdown 文件" },
    "storage.check.3": { en: "Stale HTML pages cleaned automatically on regeneration", zh: "重新生成时自动清理失效的 HTML 页面" },

    "preview.title": { en: "See it in action", zh: "实际效果一览" },
    "preview.sub": {
      en: "Every session becomes a browsable record — click any session to open the full conversation.",
      zh: "每次会话都是一份可浏览的记录——点击任意会话即可打开完整对话。",
    },

    "usage.title": { en: "Get started in one line", zh: "一行配置，立即开始" },
    "usage.sub": {
      en: "No manual installation. OpenCode installs npm plugins automatically with Bun at startup.",
      zh: "无需手动安装。OpenCode 启动时会自动用 Bun 安装 npm 插件。",
    },
    "usage.step1.title": { en: "Add the plugin", zh: "添加插件" },
    "usage.step1.desc": {
      en: "Add one line to your project or user config. User-level config covers every project.",
      zh: "在项目级或用户级配置中添加一行。建议加到用户级配置，覆盖所有项目。",
    },
    "usage.step2.title": { en: "Start a conversation", zh: "开始对话" },
    "usage.step2.desc": {
      en: "A file is created the moment a new conversation starts. Every idle event snapshots the full session.",
      zh: "新对话开始即自动创建文件。每次空闲事件都会保存完整会话快照。",
    },
    "usage.step3.title": { en: "Browse the records", zh: "查看记录" },
    "usage.step3.desc": {
      en: "Open the Markdown files, or regenerate the two-tier HTML views with one CLI command.",
      zh: "直接查看 Markdown 文件，或用一条 CLI 命令重新生成双级 HTML 视图。",
    },

    "faq.title": { en: "FAQ", zh: "常见问题" },
    "faq.q1": { en: "Do I need to install it first?", zh: "需要先安装吗？" },
    "faq.a1": {
      en: "No. Once the plugin is listed in your <code>opencode.json</code>, OpenCode installs it automatically using Bun at startup (cached in <code>~/.cache/opencode/node_modules/</code>).",
      zh: "不需要。只要在 <code>opencode.json</code> 中列出插件，OpenCode 启动时就会自动用 Bun 安装（缓存于 <code>~/.cache/opencode/node_modules/</code>）。",
    },
    "faq.q2": { en: "Where are sessions saved?", zh: "会话保存在哪里？" },
    "faq.a2": {
      en: "In <code>~/opencode-autorecord/&lt;project-name&gt;/</code> — one folder per project, kept outside the project itself so your repo stays untouched.",
      zh: "保存在 <code>~/opencode-autorecord/&lt;项目名&gt;/</code>——每个项目一个文件夹，位于项目之外，仓库不受任何影响。",
    },
    "faq.q3": { en: "When does the plugin save?", zh: "什么时候保存？" },
    "faq.a3": {
      en: "On session idle after a 2s debounce, and immediately when a session is deleted or compacted. A message cache avoids re-fetching full history on every idle event.",
      zh: "会话空闲后 2 秒防抖保存；会话删除或压缩时立即保存。消息缓存避免每次空闲都重新拉取完整历史。",
    },
    "faq.q4": { en: "How are images handled?", zh: "图片怎么处理？" },
    "faq.a4": {
      en: "Base64 images are extracted in parallel and saved as standalone files under an <code>images/</code> directory, then replaced with local paths in the Markdown — keeping the files clean.",
      zh: "base64 图片被并行提取并保存为 <code>images/</code> 目录下的独立文件，再替换为 Markdown 中的本地路径——文件保持整洁。",
    },
    "faq.q5": { en: "Where do subagent sessions appear?", zh: "子会话保存在哪里？" },
    "faq.a5": {
      en: "Child sessions are inlined inside the parent session's Markdown file under a \"Child Sessions\" section. They never create separate files.",
      zh: "子会话内联在父会话 Markdown 文件的 \"Child Sessions\" 部分，从不单独创建文件。",
    },
    "faq.q6": { en: "Will it affect my other plugins?", zh: "会影响其他插件吗？" },
    "faq.a6": {
      en: "No. All event-handling errors are caught and swallowed, file writes are protected by locks, and debounces keep IO minimal — the plugin is designed to be invisible.",
      zh: "不会。所有事件错误都被捕获并静默处理，文件写入有锁保护，防抖机制让 IO 开销极小——插件设计为完全隐形。",
    },
    "faq.q7": { en: "Is the HTML view live?", zh: "HTML 视图是实时更新的吗？" },
    "faq.a7": {
      en: "Views regenerate automatically (10s debounce on the main session) and you can also regenerate manually anytime with <code>opencode-autorecord regenerate ~/opencode-autorecord</code>.",
      zh: "视图会自动重新生成（主会话 10 秒防抖），也可以随时用 <code>opencode-autorecord regenerate ~/opencode-autorecord</code> 手动生成。",
    },
    "faq.q8": { en: "Are there Windows differences?", zh: "Windows 平台有什么差异？" },
    "faq.a8": {
      en: "On Windows, <code>~</code> is NOT expanded in CLI paths — pass a full path like <code>C:\\Users\\&lt;username&gt;\\opencode-autorecord</code>. User config lives at <code>%USERPROFILE%\\.config\\opencode\\opencode.json</code>. Illegal filename characters (<code>\\ / : * ? \" &lt; &gt; |</code>) are auto-replaced with <code>-</code>, but reserved device names (<code>CON</code>, <code>NUL</code>, <code>COM1</code>, …) can't be used as filenames. OpenCode officially recommends running in WSL for the best experience.",
      zh: "Windows 下 CLI 路径中的 <code>~</code> 不会被展开，必须传完整路径，如 <code>C:\\Users\\&lt;用户名&gt;\\opencode-autorecord</code>。用户级配置位于 <code>%USERPROFILE%\\.config\\opencode\\opencode.json</code>。文件名中的非法字符（<code>\\ / : * ? \" &lt; &gt; |</code>）会自动替换为 <code>-</code>，但保留设备名（<code>CON</code>、<code>NUL</code>、<code>COM1</code> 等）不能用作文件名。OpenCode 官方推荐在 WSL 中运行以获得最佳体验。",
    },

    "footer.tag": { en: "The dashcam for OpenCode", zh: "opencode的行车记录仪" },
    "footer.site": { en: "Website", zh: "官网" },
    "footer.github": { en: "GitHub", zh: "GitHub" },
    "footer.npm": { en: "npm", zh: "npm" },
    "footer.faq": { en: "FAQ", zh: "常见问题" },
    "footer.license": { en: "Apache 2.0", zh: "Apache 2.0" },
    "footer.rights": { en: "opencode-autorecord contributors", zh: "opencode-autorecord 贡献者" },
    "footer.inspiration": { en: "Inspired by the OpenCode design language", zh: "设计语言致敬 OpenCode" },
  };

  const LANG_KEY = "autorecord-lang";
  let lang = localStorage.getItem(LANG_KEY) || "zh";

  const langBtn = document.getElementById("lang-toggle");
  const langBtnText = langBtn.querySelector("span");

  function applyLang(l) {
    lang = l;
    document.documentElement.lang = l;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (I18N[key]) el.innerHTML = I18N[key][l];
    });
    document.querySelectorAll("[data-i18n-copy]").forEach((el) => {
      const key = el.dataset.i18nCopy;
      if (I18N[key]) el.textContent = I18N[key][l];
    });
    langBtnText.textContent = l === "zh" ? "EN" : "中文";
    localStorage.setItem(LANG_KEY, l);
  }

  langBtn.addEventListener("click", () => applyLang(lang === "zh" ? "en" : "zh"));

  applyLang(lang);

  /* ---------------- Theme ---------------- */

  const THEME_KEY = "autorecord-theme";
  const root = document.documentElement;
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) root.dataset.theme = savedTheme;

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
  });

  /* ---------------- Code tabs ---------------- */

  document.querySelectorAll(".code-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const group = tab.closest(".hero-code");
      group.querySelectorAll(".code-tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      group.querySelectorAll(".code-pane").forEach((p) => {
        p.classList.toggle("active", p.dataset.pane === tab.dataset.tab);
      });
    });
  });

  /* ---------------- Copy buttons ---------------- */

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      const original = btn.textContent;
      btn.textContent = "✓";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("copied");
      }, 1500);
    });
  });

  /* ---------------- Terminal animation ---------------- */

  const terminalLines = [
    { t: "[14:22:31] ", m: "session.idle detected — saving snapshot…" },
    { t: "[14:22:33] ", m: "wrote " }, { t: "", m: "~/opencode-autorecord/my-project/", a: true },
    { t: "              ", m: "20260818-14-22-30-fix-bug.md" },
    { t: "[14:22:33] ", m: "extracted 2 images → images/" },
    { t: "[14:22:43] ", m: "regenerated opencode-overview.html + projects/my-project.html" },
    { t: "[14:22:43] ", m: "all sessions archived " }, { t: "", m: "✓", ok: true },
  ];

  const terminalBody = document.getElementById("terminal-body");

  function renderTerminal() {
    terminalBody.innerHTML = "";
    let lineIdx = 0;
    let charIdx = 0;
    let current = "";
    const full = terminalLines.map((l) => l.t + l.m);

    function typeLine() {
      if (lineIdx >= terminalLines.length) {
        setTimeout(reset, 2600);
        return;
      }
      const line = full[lineIdx];
      current += line[charIdx++];
      terminalBody.innerHTML = "";
      for (let i = 0; i < terminalLines.length; i++) {
        if (i < lineIdx) {
          appendLine(i);
        } else if (i === lineIdx) {
          const span = document.createElement("span");
          const meta = terminalLines[i];
          const time = document.createElement("span");
          time.className = "t-time";
          time.textContent = meta.t;
          span.appendChild(time);
          if (meta.a) {
            const acc = document.createElement("span");
            acc.className = "t-acc";
            acc.textContent = meta.m.slice(0, charIdx - meta.t.length);
            span.appendChild(acc);
            const rest = document.createElement("span");
            rest.textContent = meta.m.slice(charIdx - meta.t.length);
            span.appendChild(rest);
          } else if (meta.ok) {
            const rest = document.createElement("span");
            rest.textContent = meta.m.slice(0, charIdx - meta.t.length);
            span.appendChild(rest);
            const ok = document.createElement("span");
            ok.className = "t-ok";
            ok.textContent = meta.m.slice(charIdx - meta.t.length);
            span.appendChild(ok);
          } else {
            span.append(meta.m.slice(0, charIdx - meta.t.length));
          }
          terminalBody.appendChild(span);
        }
      }
      if (charIdx >= line.length) {
        lineIdx++;
        charIdx = 0;
        current = "";
        const br = document.createElement("br");
        terminalBody.appendChild(br);
        setTimeout(typeLine, 260);
      } else {
        setTimeout(typeLine, 26);
      }
    }

    function appendLine(i) {
      const meta = terminalLines[i];
      const span = document.createElement("span");
      const time = document.createElement("span");
      time.className = "t-time";
      time.textContent = meta.t;
      span.appendChild(time);
      if (meta.a) {
        const acc = document.createElement("span");
        acc.className = "t-acc";
        acc.textContent = meta.m;
        span.appendChild(acc);
      } else if (meta.ok) {
        const rest = document.createElement("span");
        rest.textContent = meta.m.replace("✓", "");
        span.appendChild(rest);
        const ok = document.createElement("span");
        ok.className = "t-ok";
        ok.textContent = "✓";
        span.appendChild(ok);
      } else {
        span.append(meta.m);
      }
      terminalBody.appendChild(span);
      terminalBody.appendChild(document.createElement("br"));
    }

    function reset() {
      terminalBody.innerHTML = '<span class="terminal-caret"></span>';
      lineIdx = 0;
      charIdx = 0;
      current = "";
      setTimeout(typeLine, 900);
    }

    typeLine();
  }

  renderTerminal();

  /* ---------------- Reveal on scroll ---------------- */

  const revealEls = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("revealed");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("revealed"));
  }
})();
