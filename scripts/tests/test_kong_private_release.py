import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]


class PrivateReleaseTests(unittest.TestCase):
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

    def test_every_proxy_service_has_local_fail_closed_rate_limits(self):
        config = yaml.safe_load((ROOT / 'infra/kong/kong.yml').read_text())
        for service in config['services']:
            if service['url'] == 'http://127.0.0.1:1':
                continue
            limiter = next(plugin['config'] for plugin in service['plugins']
                           if plugin['name'] == 'rate-limiting')
            self.assertFalse(limiter['fault_tolerant'], service['name'])
            self.assertEqual(limiter['policy'], 'local')
            self.assertNotIn('redis', limiter)
            self.assertGreater(limiter['hour'], limiter['minute'])

    def test_robots_never_reaches_web(self):
        config = yaml.safe_load((ROOT / 'infra/kong/kong.yml').read_text())
        robots = next(service for service in config['services'] if service['name'] == 'robots')
        self.assertEqual(robots['plugins'][0]['config']['body'], 'User-agent: *\nDisallow: /\n')
        self.assertIn('Disallow: /', (ROOT / 'frontend/web/public/robots.txt').read_text())


if __name__ == '__main__':
    unittest.main()
