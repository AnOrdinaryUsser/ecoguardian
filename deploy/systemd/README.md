# Unidades systemd (despliegue nativo, sin Docker)

Alternativa a `docker-compose.prod.yml` para quien prefiera instalar todo
directamente sobre Ubuntu Server, sin contenedores. El paso a paso completo
está en `/DEPLOYMENT.md`, Opción B — este directorio solo contiene los
ficheros de unidad.

## Instalación rápida

```bash
sudo useradd --system --group --home-dir /opt/ecoguardian-cyl ecoguardian
sudo cp -r /ruta/al/repo /opt/ecoguardian-cyl
sudo chown -R ecoguardian:ecoguardian /opt/ecoguardian-cyl

sudo cp deploy/systemd/ecoguardian-backend.service /etc/systemd/system/
sudo cp deploy/systemd/ecoguardian-model.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ecoguardian-backend ecoguardian-model
sudo systemctl status ecoguardian-backend ecoguardian-model
```

El frontend no tiene unidad propia: en este modo se construye una vez
(`npm run build` dentro de `frontend/`) y sus ficheros estáticos resultantes
(`frontend/dist/`) los sirve Caddy directamente — Caddy ya trae su propia
unidad systemd (`caddy.service`) al instalarse desde el paquete oficial de
Debian/Ubuntu, así que no hace falta crear una aquí. Ver DEPLOYMENT.md para
la configuración de Caddy en este modo.

## Logs

```bash
journalctl -u ecoguardian-backend -f
journalctl -u ecoguardian-model -f
```
