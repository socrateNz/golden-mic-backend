// Entrées à AJOUTER dans le tableau `apps` de ~/apps/ecosystem.config.cjs sur le VPS
// (sans toucher aux entrées meddoc, shede, blanchix…).
  {
    name: "golden-mic-front",
    cwd: "/home/etarcosdev/apps/golden-mic-front-actuelle",
    script: "node_modules/next/dist/bin/next",
    args: "start -p 3004 -H 127.0.0.1",
    env: { NODE_ENV: "production" },
    max_memory_restart: "1000M",
    time: true,
  },
  {
    name: "golden-mic-back",
    cwd: "/home/etarcosdev/apps/golden-mic-back-actuelle",
    script: "node_modules/next/dist/bin/next",
    args: "start -p 3005 -H 127.0.0.1",
    env: { NODE_ENV: "production" },
    max_memory_restart: "1000M",
    time: true,
  },
