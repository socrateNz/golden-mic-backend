#!/bin/bash
# Déploie Golden Mic 237 (frontend OU backend) sur le VPS tacynt — même principe que
# deployer-blanchix.sh : clone du commit demandé dans un nouveau dossier, .env partagé,
# installation, compilation (avec le cache de la version en ligne), bascule du lien
# <app>-actuelle, redémarrage PM2, vérification, retour automatique en cas d'échec.
#
# Usage : ~/scripts/deployer-golden-mic.sh <front|back> [commit]   (sans commit : dernier de main)
# GitHub Actions l'appelle par une clé SSH limitée dans authorized_keys :
#   command="/home/etarcosdev/scripts/deployer-golden-mic.sh front",restrict ssh-ed25519 …
# le commit arrive alors dans SSH_ORIGINAL_COMMAND.
set -euo pipefail

case "${1:-}" in
  front) APP=golden-mic-front; DEPOT=https://github.com/socrateNz/golden-mic-237.git;     PORT=3004 ;;
  back)  APP=golden-mic-back;  DEPOT=https://github.com/socrateNz/golden-mic-backend.git; PORT=3005 ;;
  *) echo "Usage : $0 <front|back> [commit]"; exit 1 ;;
esac
# Page sans dépendance externe (ni Supabase ni Upstash) : répond 200 si Next.js tourne
VERIF=/

BASE=/home/etarcosdev/apps
GARDER=3
JOURNAL=$BASE/deploiements.log

exec 9> /tmp/deployer-$APP.lock
flock -n 9 || { echo "Un déploiement de $APP est déjà en cours."; exit 1; }

demande=${2:-${SSH_ORIGINAL_COMMAND:-}}
# Seul un identifiant de commit est accepté
if [ -n "$demande" ] && ! [[ "$demande" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "Identifiant de commit invalide : $demande"
  exit 1
fi

journal() { echo "$(date -Is) $APP $*" | tee -a "$JOURNAL"; }

# 1. Code (dépôts publics : clone HTTPS, aucune clé de déploiement)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone --quiet --filter=blob:none "$DEPOT" "$tmp/src"
cd "$tmp/src"
if [ -n "$demande" ]; then git checkout --quiet "$demande"; fi
commit=$(git rev-parse --short HEAD)
version="$(date +%Y%m%d-%H%M%S)-$commit"
dest=$BASE/$APP-versions/$version
mkdir -p "$BASE/$APP-versions"
mv "$tmp/src" "$dest"
cd "$dest"
journal "début $version"

# 2. Configuration partagée et cache de compilation de la version en ligne
ln -s "$BASE/$APP-partage/.env" .env
if [ -d "$BASE/$APP-actuelle/.next/cache" ]; then
  mkdir -p .next
  cp -a "$BASE/$APP-actuelle/.next/cache" .next/
fi

# 3. Installation et compilation (les variables NEXT_PUBLIC_ du .env sont figées ici)
npm ci --no-audit --no-fund
npm run build

# 4. Bascule
precedente=$(readlink -f "$BASE/$APP-actuelle" 2>/dev/null || true)
ln -sfn "$dest" "$BASE/$APP-actuelle"
pm2 restart "$APP" --update-env 2>/dev/null || pm2 start "$BASE/ecosystem.config.cjs" --only "$APP"

# 5. Vérification
repond() {
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$VERIF" || true)" = "200" ] && return 0
    sleep 2
  done
  return 1
}

if repond; then
  pm2 save > /dev/null
  journal "OK $version"
  ls -1d "$BASE/$APP-versions"/*/ | sort | head -n -"$GARDER" | while read -r ancienne; do
    [ "$(readlink -f "$ancienne")" = "$(readlink -f "$BASE/$APP-actuelle")" ] || rm -rf "$ancienne"
  done
else
  journal "ÉCHEC $version : l'application ne répond pas"
  if [ -n "$precedente" ] && [ -d "$precedente" ]; then
    ln -sfn "$precedente" "$BASE/$APP-actuelle"
    pm2 restart "$APP" --update-env
    journal "retour à $(basename "$precedente")"
  fi
  exit 1
fi
