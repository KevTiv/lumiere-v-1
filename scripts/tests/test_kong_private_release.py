import json
import re
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]


class PrivateReleaseTests(unittest.TestCase):
    def test_shared_scope_renders_every_limiter_without_client_ip_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / 'kong.yml'
            env = dict(os.environ,
                       KONG_DECLARATIVE_TEMPLATE=str(ROOT / 'infra/kong/kong.yml'),
                       KONG_DECLARATIVE_CONFIG=str(config_path),
                       LUMIERE_GATEWAY_RATE_LIMIT_SCOPE='service')
            subprocess.run(['sh', str(ROOT / 'infra/kong/render-config.sh'), '--render-only'],
                           env=env, check=True)
            rendered = yaml.safe_load(config_path.read_text())
            limiters = [plugin['config'] for service in rendered['services']
                        for plugin in service.get('plugins', [])
                        if plugin['name'] == 'rate-limiting']
            self.assertTrue(limiters)
            for limiter in limiters:
                self.assertEqual(limiter['limit_by'], 'service')
                self.assertEqual(limiter['policy'], 'cluster')
                self.assertFalse(limiter['fault_tolerant'])
            auth = next(s for s in rendered['services'] if s['name'] == 'api-auth-signin')
            self.assertEqual(auth['plugins'][0]['config']['minute'], 10)
            self.assertEqual(auth['plugins'][0]['config']['hour'], 100)

    def test_gateway_rejects_disabled_features_without_upstreams(self):
        config = yaml.safe_load((ROOT / 'infra/kong/kong.yml').read_text())
        services = {service['name']: service for service in config['services']}
        for name, status in [('web-ai', 503), ('api-auth-signup', 403),
                             ('disabled-ingestion', 404), ('scanner-reject', 404)]:
            service = services[name]
            self.assertEqual(service['url'], 'http://127.0.0.1:1')
            plugin = service['plugins'][0]
            self.assertEqual(plugin['name'], 'request-termination')
            self.assertEqual(plugin['config']['status_code'], status)

    def test_alpha_workbench_admits_only_reviewed_paths_and_methods(self):
        config = yaml.safe_load((ROOT / 'infra/kong/kong.yml').read_text())
        service = next(item for item in config['services'] if item['name'] == 'web-ai-alpha-pilot')
        self.assertEqual(service['url'], 'http://__WEB_UPSTREAM_HOST__:__WEB_UPSTREAM_PORT__')
        routes = service['routes']
        fixture = json.loads((ROOT / 'scripts/tests/fixtures/kong-alpha-ai-routes.json').read_text())
        for route in routes:
            self.assertFalse(route['strip_path'])
            self.assertEqual(route['regex_priority'], 10)
            for pattern in route['paths']:
                self.assertTrue(pattern.startswith('~/'), pattern)
                self.assertTrue(pattern.endswith('$'), pattern)

        def allowed(method, path):
            return any(method in route['methods'] and re.match(pattern[1:], path)
                       for route in routes for pattern in route['paths'])

        for method, paths in fixture.items():
            for path in paths:
                with self.subTest(method=method, path=path):
                    self.assertTrue(allowed(method.upper(), path))
                    for suffix in ['/', '/extra']:
                        self.assertFalse(allowed(method.upper(), path + suffix))
                    self.assertFalse(allowed(method.upper(), '/prefix' + path))
                    for unsupported in ['PUT', 'PATCH', 'DELETE']:
                        if path not in fixture.get(unsupported.lower(), []):
                            self.assertFalse(allowed(unsupported, path))
        for method, path in [
            ('GET', '/api/ai/report/compose'),
            ('GET', '/api/ai/inventory/low-stock'),
            ('GET', '/api/ai/evidence/runs/export'),
            ('GET', '/api/ai/evidence/review-queue'),
            ('GET', '/api/ai/evidence/runs/history'),
            ('GET', '/api/ai/skills/finance/finance_report_review'),
            ('POST', '/api/ai/skills/certifications/42'),
            ('POST', '/api/ai/knowledge/skill-promotions/company/42'),
            ('GET', '/api/ai/knowledge/skill-promotions/42/review'),
            ('POST', '/api/ai/skills/finance/unknown_review'),
            ('POST', '/api/ai/skills/finance/finance_report_review_extra'),
            ('POST', '/api/ai/skills/report-analysis/extra'),
            ('POST', '/api/ai/skills/other/readiness'),
            ('POST', '/api/ai/skills/run'),
            ('GET', '/api/ai/skills/provision-surfaces'),
            ('POST', '/api/ai/skills/user-access'),
            ('GET', '/api/ai/skills/published/42/run'),
            ('POST', '/api/ai/skills/sync'),
            ('GET', '/api/ai/rag'),
            ('GET', '/api/ai/rag/stream'),
            ('POST', '/api/ai/rag/stream/extra'),
            ('GET', '/api/ai/context/ingest'),
            ('GET', '/api/ai/evidence/ingestion/documents'),
            ('POST', '/api/ai/search'),
            ('POST', '/api/ai/forms/unknown'),
            ('POST', '/api/ai/vision/analyze'),
            ('POST', '/api/ai/skills/import-mapping'),
        ]:
            self.assertFalse(allowed(method, path), (method, path))
        for identifier in ['0', '-1', '01', '1x']:
            self.assertFalse(allowed('GET', '/api/ai/skills/certifications/' + identifier))
            self.assertFalse(allowed('POST', '/api/ai/skills/published/' + identifier + '/run'))
            self.assertFalse(allowed('GET', '/api/ai/knowledge/skill-promotions/company/' + identifier))
            self.assertFalse(allowed('POST', '/api/ai/knowledge/skill-promotions/' + identifier + '/review'))

    def test_every_proxy_service_has_postgres_fail_closed_rate_limits(self):
        config = yaml.safe_load((ROOT / 'infra/kong/kong.yml').read_text())
        for service in config['services']:
            if service['url'] == 'http://127.0.0.1:1':
                continue
            limiter = next(plugin['config'] for plugin in service['plugins']
                           if plugin['name'] == 'rate-limiting')
            self.assertFalse(limiter['fault_tolerant'], service['name'])
            self.assertEqual(limiter['policy'], 'cluster')
            self.assertNotIn('redis', limiter)
            self.assertGreater(limiter['hour'], limiter['minute'])

    def test_robots_never_reaches_web(self):
        config = yaml.safe_load((ROOT / 'infra/kong/kong.yml').read_text())
        robots = next(service for service in config['services'] if service['name'] == 'robots')
        self.assertEqual(robots['plugins'][0]['config']['body'], 'User-agent: *\nDisallow: /\n')
        self.assertIn('Disallow: /', (ROOT / 'frontend/web/public/robots.txt').read_text())


if __name__ == '__main__':
    unittest.main()
