# Issue tracker: GitHub

本仓库的 Issue 和已发布规格位于 GitHub：
wenhuorongbing-netizen/babacom。使用 gh CLI，并显式指定该仓库。

原仓库 `leolou0512/babacom` 保留为 upstream。

## Operations

- 创建：gh issue create --repo wenhuorongbing-netizen/babacom --title "<title>" --body-file "<body-file>"
- 读取：gh issue view <number> --repo wenhuorongbing-netizen/babacom --comments
- 列表：gh issue list --repo wenhuorongbing-netizen/babacom --state open --json number,title,labels
- 评论：gh issue comment <number> --repo wenhuorongbing-netizen/babacom --body-file "<body-file>"
- 标签：gh issue edit <number> --repo wenhuorongbing-netizen/babacom --add-label "<label>"
- 移除标签：gh issue edit <number> --repo wenhuorongbing-netizen/babacom --remove-label "<label>"
- 关闭：gh issue close <number> --repo wenhuorongbing-netizen/babacom

多行正文使用 UTF-8 文件和 --body-file，适配 PowerShell。
操作遵循当前任务授权与仓库 AGENTS.md。

## Labels

名称映射见 triage-labels.md。
应用前查询实际标签；缺失或无权限时报告，不能声称已标记。

## Pull requests as a triage surface

**PRs as a request surface: no.**

“publish to the issue tracker”指创建 GitHub Issue；
“fetch the relevant ticket”指读取对应 Issue 和评论。
