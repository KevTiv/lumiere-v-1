"""Exercise the real gateway against isolated PostgreSQL, with no Redis.

Requires Docker and PyYAML. Creates only uniquely named disposable resources.
"""
import json
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

import yaml

ROOT = Path(__file__).resolve().parents[2]
PREFIX = 'lumiere-kong-test-' + secrets.token_hex(5)
NETWORK = PREFIX + '-network'
IMAGE = PREFIX + ':test'
DB = PREFIX + '-postgres'
UPSTREAM = PREFIX + '-web'
PASSWORD = secrets.token_urlsafe(32)
CONTAINERS = []
# Test traffic is loopback only; never send it through a workstation HTTP proxy.
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def docker(*args, check=True):
    result = subprocess.run(['docker', *args], capture_output=True, text=True)
    if check and result.returncode:
        # Docker errors can include command arguments: never display the secret.
        raise RuntimeError(result.stderr.replace(PASSWORD, '[redacted]'))
    return (result.stdout + (result.stderr if not check else '')).strip()


def wait_for(test, description, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if test():
            return
        time.sleep(0.5)
    raise AssertionError('timed out: ' + description)


def request(port, path, headers=None):
    try:
        with HTTP.open(urllib.request.Request(
            f'http://127.0.0.1:{port}{path}', headers=headers or {}
        ), timeout=8) as response:
            return response.status, response.headers
    except urllib.error.HTTPError as error:
        return error.code, error.headers
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return 0, {}


def proxy_port(name):
    ports = json.loads(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', name))
    return int(ports['8000/tcp'][0]['HostPort'])


def start_gateway(suffix, template):
    name = PREFIX + suffix
    CONTAINERS.append(name)
    docker('run', '-d', '--name', name, '--network', NETWORK,
           '-p', '127.0.0.1::8000', '-p', '127.0.0.1::8001',
           '--mount', f'type=bind,src={template},dst=/test/kong.yml,readonly',
           '-e', 'KONG_DECLARATIVE_TEMPLATE=/test/kong.yml',
           '-e', f'KONG_PG_HOST={DB}', '-e', f'KONG_PG_PASSWORD={PASSWORD}',
           '-e', 'KONG_PG_SSL=off', '-e', f'WEB_UPSTREAM_HOST={UPSTREAM}',
           '-e', 'LUMIERE_ENV=production',
           '-e', 'LUMIERE_GATEWAY_RATE_LIMIT_SCOPE=service',
           '-e', 'KONG_TRUSTED_IPS=0.0.0.0/0',
           '-e', 'WEB_UPSTREAM_PORT=8080', '-e', 'KONG_ADMIN_LISTEN=0.0.0.0:8001',
           IMAGE)
    ports = json.loads(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', name))
    proxy = int(ports['8000/tcp'][0]['HostPort'])
    admin = int(ports['8001/tcp'][0]['HostPort'])
    wait_for(lambda: request(proxy, '/health/ready')[0] == 200, 'gateway readiness')
    wait_for(lambda: request(proxy, '/api/query')[0] == 200, 'upstream DNS readiness')
    assert request(admin, '/services')[0] == 0, 'Admin API is exposed'
    return name, proxy


def main():
    try:
        docker('build', '-t', IMAGE, '-f', str(ROOT / 'infra/kong/Dockerfile'), str(ROOT))
        docker('network', 'create', NETWORK)
        CONTAINERS.append(DB)
        docker('run', '-d', '--name', DB, '--network', NETWORK,
               '-e', 'POSTGRES_USER=lumiere_kong', '-e', 'POSTGRES_DB=lumiere_kong',
               '-e', f'POSTGRES_PASSWORD={PASSWORD}', 'postgres:18-alpine')
        wait_for(lambda: 'accepting connections' in docker(
            'exec', DB, 'pg_isready', '-U', 'lumiere_kong', check=False), 'PostgreSQL')
        CONTAINERS.append(UPSTREAM)
        docker('run', '-d', '--name', UPSTREAM, '--network', NETWORK,
               'python:3.12-alpine', 'python', '-u', '-c',
               'from http.server import BaseHTTPRequestHandler, HTTPServer\n'
               'class Handler(BaseHTTPRequestHandler):\n'
               ' def do_GET(self):\n'
               '  self.send_response(200); self.end_headers(); self.wfile.write(b"ok")\n'
               'HTTPServer(("0.0.0.0",8080),Handler).serve_forever()')
        with tempfile.TemporaryDirectory() as directory:
            template = Path(directory, 'kong.yml')
            config = yaml.safe_load((ROOT / 'infra/kong/kong.yml').read_text())
            # Bound the restart test across minute boundaries without changing
            # deployment thresholds. The hour/day windows share the test limit.
            auth = next(s for s in config['services'] if s['name'] == 'api-auth-signin')
            auth['plugins'][0]['config'].update(hour=10, day=10)
            template.write_text(yaml.safe_dump(config))
            template.chmod(0o644)  # Kong runs as an unprivileged container user.
            first, port = start_gateway('-first', template)
            for i in range(10):
                status, _ = request(port, '/api/auth/signin', {
                    'X-Forwarded-For': f'198.51.100.{i + 1}',
                    'X-Real-IP': f'198.51.100.{i + 1}',
                })
                assert status == 200, (i, status)
                # The native plugin increments through a timer. This checks
                # persisted/shared counters, not atomic burst admission.
                time.sleep(0.2)
            status, headers = request(port, '/api/auth/signin')
            assert status == 429, status
            assert headers.get('RateLimit-Limit') == '10', dict(headers)
            assert headers.get('Retry-After'), dict(headers)
            _, second_port = start_gateway('-second', template)
            # Both public listeners see the same Docker bridge source IP.
            assert request(second_port, '/api/auth/signin')[0] == 429
            print('Shared counters and 429 headers verified', flush=True)
            docker('restart', first)
            port = proxy_port(first)
            wait_for(lambda: request(port, '/health/ready')[0] == 200, 'restarted gateway')
            assert request(port, '/api/auth/signin')[0] == 429
            print('Counter persistence across restart verified', flush=True)
            # Unlike db_import, sync must delete routes removed from the source.
            config = yaml.safe_load(template.read_text())
            config['services'] = [s for s in config['services'] if s['name'] != 'api-auth-signin']
            template.write_text(yaml.safe_dump(config))
            docker('restart', first)
            port = proxy_port(first)
            wait_for(lambda: request(port, '/health/ready')[0] == 200, 'reconciled gateway')
            wait_for(lambda: request(port, '/api/auth/signin')[0] == 200,
                     'stale route deletion and upstream readiness')
            print('Deleted-route reconciliation verified', flush=True)
            # Outage must reject a fresh, below-limit route instead of forwarding.
            docker('stop', DB)
            wait_for(lambda: request(port, '/api/query')[0] == 500,
                     'fail-closed database outage', timeout=40)
        print('Kong PostgreSQL integration passed: shared and durable counters, 429 headers, '
              'untrusted IP headers ignored, stale routes removed, Admin API closed, DB outage denied')
    except Exception:
        for name in CONTAINERS:
            if name.endswith(('-first', '-second')):
                logs = docker('logs', '--tail', '30', name, check=False)
                print(name, docker('inspect', '--format', '{{json .State}}', name, check=False))
                print(logs.replace(PASSWORD, '[redacted]'))
        raise
    finally:
        for name in reversed(CONTAINERS):
            docker('rm', '-fv', name, check=False)
        docker('network', 'rm', NETWORK, check=False)
        docker('image', 'rm', IMAGE, check=False)


if __name__ == '__main__':
    main()
