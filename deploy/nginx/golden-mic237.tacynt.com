# Golden Mic 237 sur golden-mic237.tacynt.com (VPS tacynt).
# Un seul domaine pour les deux applications Next.js (PM2, 127.0.0.1 uniquement) :
#   /api/  → backend  (dépôt golden-mic-backend, 127.0.0.1:3005)
#   le reste → frontend (dépôt golden-mic-237,   127.0.0.1:3004)
# Le navigateur appelle donc l'API sur la même origine (NEXT_PUBLIC_API_URL = le domaine) : plus de CORS.
# HTTPS ajouté ensuite par : sudo certbot --nginx -d golden-mic237.tacynt.com --redirect
server {
    listen 80;
    server_name golden-mic237.tacynt.com;

    # Photo des candidats à l'inscription (aucune limite côté code : Nginx la fixe ici)
    client_max_body_size 10m;

    location /api/ {
        proxy_pass http://127.0.0.1:3005;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;   # écrase la valeur du client : limiteur de votes non falsifiable
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
    }

    location / {
        proxy_pass http://127.0.0.1:3004;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
    }
}
