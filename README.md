# Deepwood DND

<p align="center">
  <img src="./frontend/public/logo.png" alt="Deepwood DND logo - dragon holding a d20" width="280" />
</p>

**Deepwood DND** is a free, full-stack virtual tabletop platform for
Dungeons & Dragons-style campaigns. It helps groups manage characters, parse
modules, and play sessions on a shared tactical map with real-time
collaboration.

Deepwood DND 是一个免费的全栈虚拟桌面角色扮演平台，面向 Dungeons & Dragons
风格的战役体验。它支持角色管理、模组解析、共享战术地图、实时协作、骰子流程
和 AI 辅助。

> **Unofficial / 非官方声明**  
> Deepwood DND is not affiliated with, endorsed, sponsored, or approved by
> Wizards of the Coast. Deepwood DND provides product/software code only; it
> does not provide D&D content rights.  
> Deepwood DND 与 Wizards of the Coast 无从属、授权、赞助或认可关系。本项目
> 只提供产品和软件代码，不提供 D&D 相关内容、商标、设定或版权授权。

## Product Showcase / 产品展示

![Deepwood DND tactical tabletop showcase](./docs/assets/showcase/combat-tabletop.png)

Deepwood DND combines a real-time tactical tabletop, character automation,
asset management, dice resolution, and AI-assisted DM preparation. The full
showcase includes screenshots for combat, character creation, AI module prep,
map generation, inventory/assets, and dice automation.

Deepwood DND 集成实时战术桌面、角色自动计算、资产管理、骰子裁定和 AI 辅助备团。
完整展示页包含战斗桌面、创建角色、AI 读规则/读模组、AI 备团、地图生成、装备资产
和骰子自动计算等截图。

See the hosted showcase page and the Markdown walkthrough:
[`GitHub Pages showcase`](https://leehow.github.io/deepwood-dnd/showcase/) ·
[`docs/showcase.md`](./docs/showcase.md).

完整中英双语产品展示：
[`GitHub Pages 展示页`](https://leehow.github.io/deepwood-dnd/showcase/) ·
[`docs/showcase.md`](./docs/showcase.md)。

## Features / 功能

- **Campaigns & characters / 战役与角色** — create and manage 5E-style
  characters, level-ups, multiclassing, spells, equipment, and currency.
- **Real-time tabletop / 实时战术桌面** — Konva-based tactical map with tokens,
  fog of war, drawing, rulers, terrain, music, and WebSocket synchronization.
- **Dice flow / 骰子流程** — a DM → player → adjudication roll workflow.
- **Automated character math / 角色自动计算** — ability bonuses, derived stats,
  resources, equipment constraints, and character sheet data are calculated
  where possible.
- **Module pipeline / 模组流水线** — upload PDF/Markdown content, OCR/parse it,
  and organize chapters, monsters, items, maps, and notes.
- **AI assists / AI 辅助** — optional chat, image/avatar generation, OCR, and
  module processing integrations. Bring your own provider keys.
- **AI DM prep and asset generation / AI 备团与资产生成** — use AI to read
  rules/modules, summarize prep notes, create NPCs, monsters, chests, maps,
  encounters, and other campaign assets.

## Tech Stack / 技术栈

**Frontend / 前端**

- React Router v7 + React 18 + TypeScript
- Zustand, React Query, Konva.js, Tailwind CSS, Radix UI
- Vite

**Backend / 后端**

- FastAPI, PostgreSQL, asyncpg, SQLAlchemy 2.0
- Alembic migrations, WebSocket, Pydantic
- Redis optional cache

**AI services / AI 服务**

Provider identity and API keys are supplied through environment variables or
in-app settings. No provider keys are bundled.

AI 服务的身份和密钥通过环境变量或应用内配置提供；仓库不内置任何服务商密钥。

## Quick Start / 快速开始

### Prerequisites / 前置要求

- Python 3.11+
- Node.js 20+
- PostgreSQL 15+
- Redis (optional / 可选)

### Setup / 安装

1. Clone the repository / 克隆仓库:

   ```bash
   git clone https://github.com/Leehow/deepwood-dnd.git
   cd deepwood-dnd
   ```

2. Backend environment / 后端环境:

   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate      # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. Frontend / 前端依赖:

   ```bash
   cd frontend
   npm install
   ```

4. Configure environment variables / 配置环境变量:

   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```

   Fill in your own local values and never commit `.env` files.  
   请填入你自己的本地配置，不要提交 `.env` 文件。

5. Run database migrations / 执行数据库迁移:

   ```bash
   cd backend
   alembic upgrade head
   ```

## Development / 开发

Start both services with the helper script / 用启动脚本同时运行前后端:

```bash
chmod +x dev-start.sh
./dev-start.sh
```

Then open / 然后打开:

- Frontend / 前端: <http://localhost:5174>
- Backend API docs / 后端 API 文档: <http://localhost:8174/docs>

Manual start / 手动启动:

```bash
# Backend
cd backend
python -m uvicorn app.main:app --reload --port 8174

# Frontend
cd frontend
npm run dev -- --port 5174
```

## Testing / 测试

```bash
# Backend
cd backend && pytest
pytest tests/test_file.py -v
pytest --no-cov

# Frontend
cd frontend && npm run test
cd frontend && npm run typecheck
npx playwright test
```

Quality gates / 质量检查:

```bash
bash scripts/quality/check_transport_contracts.sh
bash scripts/quality/check_repo_hygiene.sh
```

## Project Structure / 项目结构

```text
.
├── backend/         # FastAPI backend / 后端服务
├── frontend/        # React Router frontend / 前端应用
├── scripts/         # Data and maintenance utilities / 数据与维护脚本
├── docs/            # Architecture and design docs / 架构与设计文档
├── debug/           # E2E and debug scripts / 调试脚本
├── dnd-platform/    # Reference data + runtime directories / 参考数据与运行目录
└── dev-start.sh     # Development startup script / 开发启动脚本
```

`dnd-platform/upload/`, `dnd-platform/configs/modules/`, and
`dnd-platform/modules/` are runtime working directories. They are created on
demand and intentionally not tracked in Git.

`dnd-platform/upload/`、`dnd-platform/configs/modules/` 和
`dnd-platform/modules/` 是运行时目录，会按需创建，仓库中不跟踪。

## Legal & Content Boundary / 法律与内容边界

Deepwood DND is unofficial fan software. It is not affiliated with, endorsed,
or approved by Wizards of the Coast. Dungeons & Dragons is a trademark of
Wizards of the Coast LLC.

Deepwood DND 是非官方粉丝软件，与 Wizards of the Coast 无从属、授权或认可关系。
Dungeons & Dragons 是 Wizards of the Coast LLC 的商标。

- **Application code / 应用代码** — licensed under the Apache License 2.0.
  See [`LICENSE`](./LICENSE).
- **License boundary / 协议边界** — Apache-2.0 covers only Deepwood DND
  software/product code. It does not grant rights to D&D rules text,
  trademarks, lore, official books/adventures, artwork, maps, modules, uploads,
  generated campaign content, or third-party data/assets.
- **协议边界** — Apache-2.0 只覆盖 Deepwood DND 的软件和产品代码，不授权任何
  D&D 规则文本、商标、设定、官方书籍/冒险、美术、地图、模组、上传内容、生成战役
  内容或第三方数据/素材。
- **Open Game Content / 开放游戏内容** — SRD/Open Game Content is governed
  separately; see [`LICENSE-OGL.md`](./LICENSE-OGL.md).
- **Third-party and content notice / 第三方与内容声明** — see
  [`NOTICE.md`](./NOTICE.md) and [`LEGAL.md`](./LEGAL.md).

Commercial use of the Deepwood DND software may be allowed by Apache-2.0, but
commercial use of D&D-related content or branding is separate. If you build a
commercial product or service with Deepwood DND, you must independently comply
with the applicable D&D/Wizards/SRD/OGL/Fan Content Policy and third-party
rights requirements. We provide product code; we do not provide D&D content
rights.

Apache-2.0 可能允许你商业使用 Deepwood DND 的软件代码，但这不等于允许商业使用
D&D 相关内容或品牌。如果你基于 Deepwood DND 做商业产品或服务，需要自行确保
符合 D&D/Wizards/SRD/OGL/Fan Content Policy 以及第三方版权要求。我们提供的是
产品代码，不提供 D&D 内容权利。

### Excluded content / 不包含的内容

The public repository intentionally excludes:

- Scanned or OCR-converted official D&D books and published adventures.
- Uploaded source files and parsed/generated module output.
- PDFs, CHM archives, ZIP book archives, local environment files, secrets, and
  API keys.

公共仓库有意排除了：

- 官方 D&D 书籍和已出版冒险的扫描版/OCR 转换版。
- 用户上传源文件及其解析/生成的模组产物。
- PDF、CHM、ZIP 书籍归档、本地环境文件、密钥和 API key。

If you self-host Deepwood DND and upload your own books, modules, maps, assets,
or data, you are responsible for holding the necessary rights and complying
with all applicable content policies and laws.

如果你自托管 Deepwood DND 并上传自己的书籍、模组、地图、素材或数据，你需要自行
确保拥有相应权利，并遵守相关内容政策与法律要求。

## Contributing / 贡献

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Please report security issues
privately per [`SECURITY.md`](./SECURITY.md).

请阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。安全问题请按
[`SECURITY.md`](./SECURITY.md) 私下报告。

## License / 许可证

Deepwood DND application code is licensed under the Apache License 2.0. Game
content and third-party material are governed separately as described above.

Deepwood DND 应用代码使用 Apache License 2.0。游戏内容和第三方材料按上文所述
另行适用其各自协议。
