# QuietRoom Matrix prototype

This folder is an isolated Synapse homeserver prototype. It does not change the existing QuietRoom Express/Socket.IO service.

## Render settings

- Service name: quietroom-matrix
- Runtime: Docker
- Dockerfile path: matrix-prototype/Dockerfile
- Docker context: matrix-prototype
- Region: Singapore
- Plan: Free
- Branch: matrix-prototype

Environment variables:
- SYNAPSE_SERVER_NAME=quietroom-matrix.onrender.com
- SYNAPSE_REPORT_STATS=no
- SYNAPSE_CONFIG_PATH=/data/homeserver.yaml
- SYNAPSE_HTTP_PORT=10000
- SYNAPSE_NO_TLS=true

## Prototype limitations

This uses Synapse's default SQLite database and the container's ephemeral filesystem. It is for disposable tests only. A restart, redeploy, or instance replacement can erase the database, signing key, and media. Do not use real conversations or sensitive data. Render Free services can sleep when idle.

Federation is disabled. Registration is disabled by default. Before connecting the QuietRoom client, configure controlled account creation and validate the client API and encryption flow.

## Verify

After deployment, check:
- GET /_matrix/client/versions
- GET /_matrix/client/v3/login

A successful versions response confirms the client API is reachable; it does not prove end-to-end encryption is correctly integrated.
