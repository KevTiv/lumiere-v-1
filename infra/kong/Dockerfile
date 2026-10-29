FROM kong/deck:v1.43.0 AS deck
FROM kong:3.9

COPY --from=deck /usr/local/bin/deck /usr/local/bin/deck

USER root
RUN mkdir -p /kong/declarative /kong/templates \
  && chown -R kong:0 /kong/declarative /kong/templates
COPY --chown=kong:0 infra/kong/kong.yml /kong/templates/kong.yml
COPY --chown=kong:0 infra/kong/render-config.sh /usr/local/bin/render-kong-config
COPY --chown=kong:0 infra/kong/prepare-database.sh /usr/local/bin/prepare-kong-database
RUN chmod 0755 /usr/local/bin/render-kong-config /usr/local/bin/prepare-kong-database

USER kong
ENV KONG_DATABASE=postgres \
    KONG_PG_DATABASE=lumiere_kong \
    KONG_PG_USER=lumiere_kong \
    KONG_RENDERED_CONFIG=/kong/declarative/kong.yml \
    KONG_DECLARATIVE_TEMPLATE=/kong/templates/kong.yml \
    KONG_ADMIN_LISTEN=off \
    KONG_ADMIN_GUI_LISTEN=off \
    KONG_STATUS_LISTEN=off \
    KONG_ANONYMOUS_REPORTS=off \
    KONG_NGINX_HTTP_CLIENT_MAX_BODY_SIZE=32m \
    KONG_NGINX_WORKER_PROCESSES=2 \
    KONG_DNS_ORDER=LAST,SRV,A,AAAA,CNAME \
    KONG_PROXY_ACCESS_LOG=/dev/stdout \
    KONG_PROXY_ERROR_LOG=/dev/stderr
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/render-kong-config"]
CMD ["kong", "docker-start"]
