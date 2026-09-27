#!/usr/bin/env python3
"""Local HTTP proof for owner-scoped presentation draft persistence.

Required environment: API_TOKEN. Optional: API_BASE (loopback URL), MODULE_KEY,
ORG_ID, and IDENTITY_HINT. The token is never printed.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import re


def fail(message):
    raise SystemExit(f"proof failed: {message}")


base = os.environ.get("API_BASE", "http://127.0.0.1:8082").rstrip("/")
token = os.environ.get("API_TOKEN", "").strip()
second_token = os.environ.get("SECOND_API_TOKEN", "").strip()
if not token:
    fail("API_TOKEN is required")
parts = urlsplit(base)
if (parts.scheme != "http" or parts.hostname != "127.0.0.1" or parts.username
        or parts.password or parts.query or parts.fragment or parts.port is None):
    fail("API_BASE must be an isolated loopback http URL")
if not 1 <= parts.port <= 65535:
    fail("API_BASE port must be numeric and valid")
module_key = os.environ.get("MODULE_KEY", "runtime-proof")
if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?", module_key) or "--" in module_key:
    fail("MODULE_KEY must be a lowercase URL-safe slug")
org_id = os.environ.get("ORG_ID", "1")
hint = os.environ.get("IDENTITY_HINT", "")


def request(method, path, payload=None, extra_headers=None, auth_token=None):
    headers = {"Authorization": f"Bearer {auth_token or token}", "Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if hint:
        headers["x-stdb-identity"] = hint
    if extra_headers:
        headers.update(extra_headers)
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(base + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read()
        status = error.code
    try:
        value = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        value = raw.decode(errors="replace")
    print(f"{method} {path} -> {status}")
    return status, value


def expect(status, wanted, value):
    if status != wanted:
        fail(f"expected HTTP {wanted}, got {status}: {value}")


status, capability = request("GET", "/v1/presentation/capabilities")
expect(status, 200, capability)
caps = capability.get("capabilities", [])
if len(caps) != 1 or not caps[0].get("fields"):
    fail("account-moves capability did not expose fields")
fields = caps[0]["fields"][: min(2, len(caps[0]["fields"]))]
contract = caps[0]["contractPin"]
components = capability.get("componentCatalogVersion", 1)


def definition(title, revision=None):
    return {
        "schemaVersion": 1,
        "moduleId": module_key,
        "title": title,
        "baseRevision": revision,
        "applicationContract": contract,
        "componentCatalogVersion": components,
        "pages": [{
            "id": "overview",
            "title": "Overview",
            "nodes": [{
                "kind": "collection",
                "id": "entries",
                "slot": "primary",
                "component": {"id": "erp.collection", "version": 1},
                "resource": "account-moves",
                "fields": fields,
                "pageSize": 10,
            }],
        }],
    }


status, before = request("GET", "/v1/presentation/drafts")
expect(status, 200, before)
if not isinstance(before.get("drafts"), list) or len(before["drafts"]) > 100:
    fail("draft list is not bounded")

status, created = request("POST", "/v1/presentation/drafts", {
    "expectedRevision": None,
    "definition": definition("Runtime proof v1"),
})
expect(status, 200, created)
if created["moduleKey"] != module_key or created["revision"] != "1":
    fail("new draft did not return revision 1")

status, reopened = request("GET", f"/v1/presentation/drafts/{module_key}")
expect(status, 200, reopened)
if reopened["revision"] != "1" or reopened["definition"]["baseRevision"] != "1":
    fail("reopened draft did not carry its edit revision")

status, updated = request("POST", "/v1/presentation/drafts", {
    "expectedRevision": "1",
    "definition": definition("Runtime proof v2", "1"),
})
expect(status, 200, updated)
if updated["revision"] != "2":
    fail("update did not return exact next revision")

status, conflict = request("POST", "/v1/presentation/drafts", {
    "expectedRevision": "1",
    "definition": definition("stale writer", "1"),
})
expect(status, 409, conflict)

status, final = request("GET", f"/v1/presentation/drafts/{module_key}")
expect(status, 200, final)
if final["revision"] != "2" or final["definition"]["title"] != "Runtime proof v2":
    fail("stale write changed the current snapshot")

# A caller-controlled identity hint must not switch the authenticated owner.
forged = "00" * 32
status, hinted = request("GET", "/v1/presentation/drafts",
                        extra_headers={"x-stdb-identity": forged})
expect(status, 200, hinted)
if not any(d.get("moduleKey") == module_key for d in hinted.get("drafts", [])):
    fail("forged identity hint changed the authenticated owner view")

if second_token:
    status, other_owner = request("GET", "/v1/presentation/drafts", auth_token=second_token)
    expect(status, 200, other_owner)
    if any(d.get("moduleKey") == module_key for d in other_owner.get("drafts", [])):
        fail("second authenticated owner can see the first owner's draft")
    print("PASS: second authenticated owner cannot see the first owner's draft")
else:
    print("SKIP: SECOND_API_TOKEN not supplied; forged identity hint check ran")

print(f"PASS: owner-scoped save/list/read, exact revision, HTTP409 conflict, and identity-hint isolation for {module_key}")
