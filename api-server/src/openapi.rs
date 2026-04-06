//! Static OpenAPI 3.0 document for tooling (Expo, `api-codegen`, Postman).

use serde_json::{json, Value};

/// Full document with paths as served by this binary (including `/v1` prefix).
pub fn specification() -> Value {
    json!({
        "openapi": "3.0.3",
        "info": {
            "title": "Lumiere API Server",
            "version": env!("CARGO_PKG_VERSION"),
            "description": "Rust gateway: SpacetimeDB SQL queries, reducer calls, and domain routes aligned with Next.js `/api/*`. Auth: `Authorization: Bearer <stdb_token>` and/or `stdb_token` cookie."
        },
        "servers": [{ "url": "/", "description": "API host root" }],
        "tags": [
            { "name": "health" },
            { "name": "meta" },
            { "name": "query" },
            { "name": "call" },
            { "name": "crm" },
            { "name": "sales" },
            { "name": "accounting" },
            { "name": "inventory" },
            { "name": "settings" },
            { "name": "bootstrap" },
            { "name": "proposals" }
        ],
        "paths": {
            "/health": {
                "get": {
                    "tags": ["health"],
                    "summary": "Liveness probe",
                    "responses": { "200": { "description": "OK" } }
                }
            },
            "/v1/openapi.json": {
                "get": {
                    "tags": ["meta"],
                    "summary": "This OpenAPI document",
                    "responses": {
                        "200": {
                            "description": "OpenAPI JSON",
                            "content": { "application/json": { "schema": { "type": "object" } } }
                        }
                    }
                }
            },
            "/v1/query/{resource}": {
                "get": {
                    "tags": ["query"],
                    "summary": "List rows for a registered resource (org-scoped SQL)",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "parameters": [
                        { "name": "resource", "in": "path", "required": true, "schema": { "type": "string" } },
                        { "name": "organizationId", "in": "query", "required": false, "schema": { "type": "integer", "format": "int64" } }
                    ],
                    "responses": {
                        "200": {
                            "description": "Wrapped array",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "data": { "type": "array", "items": { "type": "object" } }
                                        }
                                    }
                                }
                            }
                        },
                        "401": { "$ref": "#/components/responses/Error" },
                        "403": { "$ref": "#/components/responses/Error" },
                        "404": { "$ref": "#/components/responses/Error" }
                    }
                }
            },
            "/v1/call/{reducer}": {
                "post": {
                    "tags": ["call"],
                    "summary": "Invoke a SpacetimeDB reducer (JSON array body)",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "parameters": [
                        { "name": "reducer", "in": "path", "required": true, "schema": { "type": "string" } },
                        { "name": "withCompany", "in": "query", "required": false, "schema": { "type": "boolean" } }
                    ],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "oneOf": [
                                        { "type": "array", "items": {} },
                                        { "type": "object" }
                                    ]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "Success",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": { "ok": { "type": "boolean" } }
                                    }
                                }
                            }
                        },
                        "401": { "$ref": "#/components/responses/Error" },
                        "403": { "$ref": "#/components/responses/Error" },
                        "422": { "$ref": "#/components/responses/Error" },
                        "500": { "$ref": "#/components/responses/Error" }
                    }
                }
            },
            "/v1/crm/leads": {
                "get": {
                    "tags": ["crm"],
                    "summary": "List leads (filters: state, userId, priority, limit, offset)",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "responses": { "200": { "description": "Paginated list" } }
                },
                "post": {
                    "tags": ["crm"],
                    "summary": "Create lead",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "requestBody": { "content": { "application/json": { "schema": { "type": "object" } } } },
                    "responses": { "201": { "description": "Created" } }
                }
            },
            "/v1/crm/leads/{id}": {
                "get": {
                    "tags": ["crm"],
                    "summary": "Get lead by id",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "responses": { "200": { "description": "Lead" }, "404": { "$ref": "#/components/responses/Error" } }
                },
                "put": {
                    "tags": ["crm"],
                    "summary": "Update lead (details / address / revenue)",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "requestBody": { "content": { "application/json": { "schema": { "type": "object" } } } },
                    "responses": { "200": { "description": "Updated" } }
                },
                "delete": {
                    "tags": ["crm"],
                    "summary": "Delete lead",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "responses": { "200": { "description": "Deleted" } }
                }
            },
            "/v1/crm/contacts": {
                "get": {
                    "tags": ["crm"],
                    "summary": "List contacts",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "responses": { "200": { "description": "Paginated list" } }
                },
                "post": {
                    "tags": ["crm"],
                    "summary": "Create contact",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "requestBody": { "content": { "application/json": { "schema": { "type": "object" } } } },
                    "responses": { "201": { "description": "Created" } }
                }
            },
            "/v1/sales/orders/{id}": {
                "get": {
                    "tags": ["sales"],
                    "summary": "Get sale order",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "responses": { "200": { "description": "Order" }, "404": { "$ref": "#/components/responses/Error" } }
                },
                "put": {
                    "tags": ["sales"],
                    "summary": "Update sale order",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "requestBody": { "content": { "application/json": { "schema": { "type": "object" } } } },
                    "responses": { "200": { "description": "Updated" } }
                },
                "delete": {
                    "tags": ["sales"],
                    "summary": "Cancel sale order",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
                    "requestBody": { "content": { "application/json": { "schema": { "type": "object" } } } },
                    "responses": { "200": { "description": "Cancelled" } }
                }
            },
            "/v1/accounting/accounts": {
                "get": {
                    "tags": ["accounting"],
                    "summary": "Chart of accounts",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "responses": { "200": { "description": "Paginated list" } }
                },
                "post": {
                    "tags": ["accounting"],
                    "summary": "Create account",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "requestBody": { "content": { "application/json": { "schema": { "type": "object" } } } },
                    "responses": { "201": { "description": "Created" } }
                }
            },
            "/v1/inventory/pickings": {
                "get": {
                    "tags": ["inventory"],
                    "summary": "Stock pickings",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "responses": { "200": { "description": "List" } }
                },
                "post": {
                    "tags": ["inventory"],
                    "summary": "Create stock picking",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "requestBody": { "content": { "application/json": { "schema": { "type": "object" } } } },
                    "responses": { "201": { "description": "Created" } }
                }
            },
            "/v1/settings/users": {
                "get": {
                    "tags": ["settings"],
                    "summary": "Organization users",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "responses": { "200": { "description": "Paginated list" } }
                }
            },
            "/v1/settings/roles": {
                "get": {
                    "tags": ["settings"],
                    "summary": "System roles",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "responses": { "200": { "description": "Paginated list" } }
                }
            },
            "/v1/bootstrap/tenant": {
                "post": {
                    "tags": ["bootstrap"],
                    "summary": "First-tenant bootstrap (no prior organization on session)",
                    "security": [{ "bearerAuth": [] }, { "stdbCookie": [] }],
                    "requestBody": { "content": { "application/json": { "schema": { "type": "object" } } } },
                    "responses": {
                        "200": { "description": "{ ok: true }" },
                        "400": { "$ref": "#/components/responses/Error" },
                        "401": { "$ref": "#/components/responses/Error" },
                        "409": { "$ref": "#/components/responses/Error" },
                        "500": { "$ref": "#/components/responses/Error" }
                    }
                }
            },
            "/v1/proposals/analyze": {
                "post": {
                    "tags": ["proposals"],
                    "summary": "Analyze proposal text (AI gateway or mock)",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["text"],
                                    "properties": {
                                        "text": { "type": "string" },
                                        "proposalId": { "type": "string" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "AIAnalysis-shaped JSON" },
                        "400": { "$ref": "#/components/responses/Error" }
                    }
                }
            }
        },
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "SpacetimeDB token"
                },
                "stdbCookie": {
                    "type": "apiKey",
                    "in": "cookie",
                    "name": "stdb_token"
                }
            },
            "responses": {
                "Error": {
                    "description": "Error",
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": { "error": { "type": "string" } }
                            }
                        }
                    }
                }
            }
        }
    })
}
