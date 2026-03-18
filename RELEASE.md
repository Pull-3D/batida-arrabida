# Release final

## Passos recomendados

1. Limpar artefactos locais:
   ```bash
   rm -rf node_modules dist dist-electron out release
   ```
2. Instalar dependências:
   ```bash
   npm install
   ```
3. Testar em desenvolvimento:
   ```bash
   npm run electron:dev
   ```
4. Gerar release local:
   ```bash
   npm run build
   ```
5. Fazer push para GitHub e usar Actions.

## Git rápido

```bash
git init
git branch -M main
git add .
git commit -m "feat: final unified desktop release"
```
