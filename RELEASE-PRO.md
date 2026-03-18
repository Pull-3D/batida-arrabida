# Release PRO

## O que mudou
- ffmpeg embutido com `ffmpeg-static`
- em desenvolvimento usa o binário do pacote
- em produção usa `process.resourcesPath/ffmpeg-static`

## Build local
```bash
npm install
npm run build
```

## Nota
Na app empacotada, a escrita de tags e o `medium-hls` já não dependem do ffmpeg do sistema.
