# Batida do Sado + Arrábida Grooves

App desktop unificada em Electron + Vue com dois módulos:
- **Batida do Sado**
- **Arrábida Grooves**

## Desenvolvimento

```bash
npm install
npm run electron:dev
```

## Build local

```bash
npm run build
```

## Builds por plataforma

```bash
npm run build:mac
npm run build:mac-arm64
npm run build:win
npm run build:win-arm64
npm run build:linux
npm run build:linux-arm64
```

## Release via GitHub Actions

O workflow principal está em:

```text
.github/workflows/release-files.yml
```

## Notas

- Em modo `electron:dev`, pode parecer que abre duas instâncias por causa do hot reload. O teste mais fiável é na app empacotada.
- O backend do módulo Arrábida grava o config em `~/Library/Application Support/Batida do Sado/beatportdl-desktop.json` no macOS.
