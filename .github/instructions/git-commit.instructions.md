---
applyTo: "**"
---

# Git Commit Message Rules

## Format

```
<type>: <verb> + <description>
```

## Types

| Type | Usage |
|------|-------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes only |
| `style` | Formatting, missing semicolons, etc. (no logic change) |
| `refactor` | Code restructuring without feature or bug changes |
| `perf` | Performance improvements |
| `test` | Adding or updating tests |
| `chore` | Build process, dependency updates, tooling config |
| `ci` | CI/CD configuration changes |
| `build` | Changes affecting the build system |
| `revert` | Reverting a previous commit |

## Rules

- Format must follow `type: verb + description`
- Start the description with an imperative verb: Add, Fix, Update, Remove, Refactor, Improve, Move, Rename, Bump, etc.
- **`<description>` 使用中文撰寫**
- Use lowercase for `<type>`
- Do NOT end with punctuation
- Keep it concise and descriptive

## Examples

```
feat: 新增使用者驗證流程
fix: 修正提交空表單時的崩潰問題
docs: 更新 README 安裝步驟
style: 使用 prettier 格式化 header 元件
refactor: 將付款邏輯抽取至 service 層
perf: 透過 lazy loading 縮減 bundle 大小
test: 新增訂單計算的單元測試
chore: 升級 eslint 至 v9
ci: 新增 PR 檢查的 GitHub Actions workflow
build: 更新 vite config 以輸出 production 版本
revert: revert feat: 新增深色模式切換
```

## Bad Examples

```
❌ fixed stuff                  ← 描述太模糊
❌ Feat: 新增登入               ← type 必須小寫
❌ feat: 新增登入功能。          ← 結尾不加標點
❌ feat: 已新增登入             ← 使用祈使句動詞（新增，而非已新增）
❌ feat:新增登入                ← 冒號後需空格
```
