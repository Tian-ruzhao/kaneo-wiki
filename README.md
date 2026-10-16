<p align="center">
  <a href="https://kaneo.app">
    <img src="https://assets.kaneo.app/logo-text.png" alt="Kaneo's logo" width="450" />
  </a>
</p>

<div align="center">

[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/usekaneo/kaneo/ci.yml?branch=main)](https://github.com/usekaneo/kaneo/actions)
[![AI Policy: Human Voice](https://img.shields.io/badge/AI_Policy-Human_Voice-blue?logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij4KICA8c3R5bGU%2BCiAgICAuaWNvbiB7CiAgICAgIGZpbGw6IG5vbmU7CiAgICAgIHN0cm9rZTogIzAwMDAwMDsKICAgICAgc3Ryb2tlLXdpZHRoOiAyLjI1OwogICAgICBzdHJva2UtbGluZWNhcDogcm91bmQ7CiAgICAgIHN0cm9rZS1saW5lam9pbjogcm91bmQ7CiAgICB9CiAgICBAbWVkaWEgKHByZWZlcnMtY29sb3Itc2NoZW1lOiBkYXJrKSB7CiAgICAgIC5pY29uIHsgc3Ryb2tlOiAjZmZmZmZmOyB9CiAgICB9CiAgPC9zdHlsZT4KICA8cGF0aCBjbGFzcz0iaWNvbiIgZD0iTTE5LjQxNCAxNC40MTRDMjEgMTIuODI4IDIyIDExLjUgMjIgOS41YTUuNSA1LjUgMCAwIDAtOS41OTEtMy42NzYuNi42IDAgMCAxLS44MTguMDAxQTUuNSA1LjUgMCAwIDAgMiA5LjVjMCAyLjMgMS41IDQgMyA1LjVsNS41MzUgNS4zNjJhMiAyIDAgMCAwIDIuODc5LjA1MiAyLjEyIDIuMTIgMCAwIDAtLjAwNC0zIDIuMTI0IDIuMTI0IDAgMSAwIDMtMyAyLjEyNCAyLjEyNCAwIDAgMCAzLjAwNCAwIDIgMiAwIDAgMCAwLTIuODI4bC0xLjg4MS0xLjg4MmEyLjQxIDIuNDEgMCAwIDAtMy40MDkgMGwtMS43MSAxLjcxYTIgMiAwIDAgMS0yLjgyOCAwIDIgMiAwIDAgMSAwLTIuODI4bDIuODIzLTIuNzYyIi8%2BCjwvc3ZnPgo%3D)](https://github.com/usekaneo/kaneo/blob/main/AI_POLICY.md)
[![Discord](https://img.shields.io/discord/1326250681530843178?color=7389D8&label=&logo=discord&logoColor=ffffff)](https://discord.gg/rU4tSyhXXU)
[![Sponsors](https://img.shields.io/github/sponsors/andrejsshell)](https://github.com/sponsors/andrejsshell)
</div>

<div align="center">
  <h3>
    <a href="https://cloud.kaneo.app">Cloud</a>
    <span> | </span>
    <a href="https://kaneo.app/docs/core/installation">Installation</a>
    <span> | </span>
    <a href="https://kaneo.app">Website</a>
    <span> | </span>
    <a href="https://discord.gg/rU4tSyhXXU">Discord</a>
  </h3>
</div>

<p align="center">
  Fast, simple, open-source project management.
</p>

<p align="center">
  <img src="screenshots/readme@1x.png" srcset="screenshots/readme@1x.png 1x, screenshots/readme.png 2x" alt="Kaneo project board with the Kaneo logo and tagline" />
</p>

## 关于本项目

本项目 fork 自 [usekaneo/kaneo](https://github.com/usekaneo/kaneo)，原项目采用 MIT 许可证（原文保留在 [LICENSE-MIT](LICENSE-MIT)）。本仓库采用 Apache 2.0 许可证（见 [LICENSE](LICENSE)）。在原项目基础上新增了**文档（Wiki 页面）功能**：

- **项目内文档目录**：每个项目可以创建树形结构的页面，支持子页面、重命名、移动和删除。
- **实时多人协同编辑**：基于 Yjs 的协同编辑，页面内容通过 `/ws/page/:pageId` 同步；单实例无需 Redis，多实例可选配置 Redis 进行消息中继。
- **富文本编辑**：斜杠命令菜单、图片粘贴/拖放上传（需要配置 S3 兼容存储）、可选择行列数的表格、单元格框选与合并拆分、文字颜色与背景高亮。
- **权限**：页面读写沿用任务的权限规则，只读成员只能查看，不能编辑。

## Built for your team's work

- **See work your way:** Board, List, Calendar, and Gantt views, plus a backlog, filters, and search.
- **Keep task context together:** descriptions, attachments, subtasks, dependencies, labels, comments, and time tracking.
- **Work with your team:** shared workspaces, invitations, custom roles, live updates, and public project views.
- **Shape your workflow:** custom columns and fields, with rules that move tasks when repository activity changes.
- **Stay informed:** in-app notifications, email, ntfy, Gotify, and personal webhooks.
- **Connect other tools:** GitHub and Gitea, chat integrations, project webhooks, a [REST API](https://kaneo.app/docs/api-reference/introduction), a [command-line client](https://kaneo.app/docs/cli), and [MCP](https://kaneo.app/docs/core/integrations/mcp) for AI assistants.

## Installation

- **Cloud:** [Get started with Kaneo Cloud](https://cloud.kaneo.app).
- **Self-hosted:** Follow the [installation guide](https://kaneo.app/docs/core/installation).

## Contributing

Code, translations, documentation, and bug reports are welcome. Start with the [contributing guide](CONTRIBUTING.md) and [local development setup](ENVIRONMENT_SETUP.md). Pay particular attention to [contribution eligibility](https://github.com/usekaneo/kaneo/blob/main/CONTRIBUTING.md#contribution-eligibility).

Join us on [Discord](https://discord.gg/rU4tSyhXXU), report bugs in [GitHub Issues](https://github.com/usekaneo/kaneo/issues), or submit and vote on feature requests at [Kaneo Feedback](https://feedback.kaneo.app).

## Sponsors

Kaneo is open source. If you find it useful, consider [sponsoring the project](https://github.com/sponsors/andrejsshell) to help support ongoing development.

### Partners

<p>
  <img src="apps/site/public/images/blacksmith-powered.png" alt="CI powered by Blacksmith" width="368" />
</p>

This project is tested with BrowserStack.

### Community sponsors

<!-- sponsors --><a href="https://github.com/danielsada"><img src="https:&#x2F;&#x2F;github.com&#x2F;danielsada.png" width="60px" alt="User avatar: Daniel Sada" /></a><a href="https://github.com/randoneering"><img src="https:&#x2F;&#x2F;github.com&#x2F;randoneering.png" width="60px" alt="User avatar: (justin)randoneering" /></a><a href="https://github.com/barbanet"><img src="https:&#x2F;&#x2F;github.com&#x2F;barbanet.png" width="60px" alt="User avatar: Damián Culotta" /></a><a href="https://github.com/ryanilano"><img src="https:&#x2F;&#x2F;github.com&#x2F;ryanilano.png" width="60px" alt="User avatar: Ryan Ilano" /></a><a href="https://github.com/bojanmilevski"><img src="https:&#x2F;&#x2F;github.com&#x2F;bojanmilevski.png" width="60px" alt="User avatar: Bojan Milevski" /></a><!-- sponsors -->

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">
  <img src="https://repobeats.axiom.co/api/embed/3e8367ec2b2350e4fc48662df33c81dac657b833.svg" alt="Repobeats analytics image" />
</div>

<p align="center">
  Built with ❤️ by the Kaneo team and <a href="https://github.com/usekaneo/kaneo/graphs/contributors">contributors</a>
</p>
