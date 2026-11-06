# Isolated Matrix Synapse prototype for Render.
# Uses SQLite and the container's temporary filesystem for testing only.
FROM matrixdotorg/synapse:v1.163.0

# Render terminates HTTPS at its edge and forwards traffic to the PORT below.
# Generate a fresh test config at each container start, then run Synapse.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["/start.py generate && sed -i 's/x_forwarded: false/x_forwarded: true/' /data/homeserver.yaml && printf '\\nfederation_enabled: false\\n' >> /data/homeserver.yaml && /start.py run"]
