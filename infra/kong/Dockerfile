FROM kong:3.9

USER root
RUN mkdir -p /kong/declarative /kong/templates \
  && chown -R kong:0 /kong/declarative /kong/templates
COPY --chown=kong:0 infra/kong/kong.yml /kong/templates/kong.yml
COPY --chown=kong:0 infra/kong/render-config.sh /usr/local/bin/render-kong-config
RUN chmod 0755 /usr/local/bin/render-kong-config

USER kong
ENV KONG_DATABASE=off \
    KONG_DECLARATIVE_CONFIG=/kong/declarative/kong.yml \
    KONG_DECLARATIVE_TEMPLATE=/kong/templates/kong.yml \
    KONG_ADMIN_LISTEN=off \
    KONG_ADMIN_GUI_LISTEN=off \
    KONG_DNS_ORDER=LAST,SRV,A,AAAA,CNAME \
    KONG_PROXY_ACCESS_LOG=/dev/stdout \
    KONG_PROXY_ERROR_LOG=/dev/stderr
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/render-kong-config"]
CMD ["kong", "docker-start"]
