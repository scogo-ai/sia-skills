---
name: scogo:hand-drawn-diagrams
description: "Use when an operator needs meta hand drawn diagrams. Create hand-drawn Excalidraw diagrams, flows, explainers, wireframes, and page mockups. Default to monochrome sketch output; allow restrained color only for page mockups when the user explicitly wants webpage-like fidelity."
tags: [meta, hand, drawn, diagrams]
metadata:
  version: 1.0.0
author: scogo-ai
---

Follow the instructions in `./workflow.md`.

Key references:
- `references/index.md`
- `references/activation-routing.xml`
- `references/fundamental-shapes.md`

## Recommended: Chrome DevTools MCP

Install `chrome-devtools-mcp` for fast PNG and animated SVG rendering — uses a real browser, no Playwright install required.

```
npm install -g chrome-devtools-mcp
```

Then add it to your Claude Code MCP config (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "chrome-devtools-mcp": {
      "command": "npx",
      "args": ["chrome-devtools-mcp"]
    }
  }
}
```

Without it, PNG and video rendering falls back to Playwright (slower, requires browser install).
