# NOTICE / 第三方与内容声明

This file summarizes the licensing layers of **Deepwood DND** and the
third-party material it relies on. It is informational; the authoritative terms
live in the referenced license files.

## 1. Application code

The original application code in this repository (everything under `backend/`,
`frontend/`, `scripts/`, build and tooling configuration, and the documentation
written for this project) is licensed under the **Apache License 2.0** — see
[`LICENSE`](./LICENSE).

## 2. Dungeons & Dragons game content

Deepwood DND is a tool for playing **Dungeons & Dragons 5th Edition**. D&D is a
trademark of Wizards of the Coast LLC. This project is **not** affiliated with,
endorsed, or approved by Wizards of the Coast.

The Apache-2.0 license for this repository covers only the Deepwood DND
software/product code. It does **not** license D&D rules text, Wizards
trademarks, Product Identity, lore, artwork, maps, official books/adventures,
uploaded modules, generated campaign content, or third-party data/assets.

- **System Reference Document (SRD 5.1)** material is used as **Open Game
  Content** under the Open Gaming License v1.0a. The OGL text and the
  designation of Open Game Content are in [`LICENSE-OGL.md`](./LICENSE-OGL.md).
- Any other D&D references are used, where applicable, under the Wizards
  **Fan Content Policy** (non-commercial, free-to-access). See
  [`LEGAL.md`](./LEGAL.md).

**Product Identity** (as defined by the OGL) and copyrighted, non-SRD book text
are **not** redistributed by this repository. See section 4.

If you commercialize a product or service based on Deepwood DND, your commercial
rights to the software are separate from your rights to any D&D-related content.
You are responsible for complying with the applicable Wizards/SRD/OGL/Fan
Content Policy and third-party content requirements. Deepwood DND provides product
code, not D&D content rights.

## 3. Bundled third-party software

Runtime dependencies are declared in `backend/requirements.txt`,
`frontend/package.json`, and the lockfiles; each carries its own license. No
third-party source is vendored into this repository beyond those declared
dependencies and the SRD reference data noted above.

## 4. Content intentionally excluded from this repository

To keep the public repository free of copyright-sensitive and private material,
the following are **not** tracked here and are excluded by `.gitignore`:

- Scanned or OCR-converted copies of official D&D books (Player's Handbook,
  Dungeon Master's Guide, Monster Manual, published adventures, etc.).
- Uploaded source files and the parsed/converted output generated from them
  (`dnd-platform/upload/`, `dnd-platform/configs/modules/`,
  `dnd-platform/modules/`). These directories are recreated at runtime.
- PDFs, CHM archives, and other distributed book formats.
- Local environment files (`.env`), secrets, and API keys.

If you run Deepwood DND, you are responsible for ensuring that any content you
upload, parse, or store complies with the rights you hold and with the Wizards
Fan Content Policy.
