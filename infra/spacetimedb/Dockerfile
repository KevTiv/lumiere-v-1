FROM clockworklabs/spacetime:v2.8.2

USER root
COPY infra/spacetimedb/railway-entrypoint.sh /usr/local/bin/lumiere-spacetimedb
RUN chmod 0755 /usr/local/bin/lumiere-spacetimedb \
  && mkdir -p /data \
  && chown -R 1000:1000 /data

VOLUME ["/data"]
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/lumiere-spacetimedb"]
